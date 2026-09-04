import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditOutcome } from '@prisma/client';
import type { Request } from 'express';
import { RequestContextService } from '../../core/request-context/request-context.service';
import type { AuditPolicy } from './audit.decorator';
import { AuditRepository } from './audit.repository';
import { AuditEventsPageDto } from './dto/audit-event-response.dto';
import { FindAuditEventsQueryDto } from './dto/find-audit-events-query.dto';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,50}$/;

type AuditedRequest = Request & { user?: { sub?: unknown; username?: unknown } };

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly repository: AuditRepository,
    private readonly requestContext: RequestContextService,
  ) {}

  async recordHttp(
    request: AuditedRequest,
    outcome: AuditOutcome,
    statusCode: number,
    responseBody?: unknown,
  ): Promise<void> {
    const context = this.requestContext.get();
    if (!context || context.skipAudit || !context.auditPolicy) return;
    const policy = context.auditPolicy;
    const resourceType = policy.resourceType ?? this.inferResourceType(context.route);
    const actorFromRequest = this.validUuid(request.user?.sub);
    const actorFromContext = this.validUuid(context.actorId);
    const actorId = actorFromRequest ?? actorFromContext;
    const actorUsernameAtEvent = actorFromRequest
      ? (this.validUsername(request.user?.username) ??
        (actorFromRequest === actorFromContext
          ? this.validUsername(context.actorUsernameAtEvent)
          : null))
      : actorFromContext
        ? this.validUsername(context.actorUsernameAtEvent)
        : null;
    const resourceId =
      this.resolveResourceId(request, policy, responseBody) ??
      (resourceType === 'USER' ? actorId : null);
    const patientId =
      this.resolvePatientId(request, policy, resourceType) ??
      (resourceType === 'PATIENT' ? resourceId : null);

    try {
      await this.repository.create({
        action: policy.action.slice(0, 64),
        outcome,
        actorId,
        actorUsernameAtEvent,
        patientId,
        resourceType,
        resourceId,
        requestId: context.requestId,
        method: context.method,
        route: context.route.slice(0, 160),
        statusCode: Math.min(599, Math.max(100, statusCode)),
        durationMs: Math.max(0, Math.min(2_147_483_647, Date.now() - context.startedAt)),
        ipHash: context.ipHash,
        userAgentHash: context.userAgentHash,
      });
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'audit_write_failed',
          requestId: context.requestId,
          action: policy.action,
          errorCode: this.errorCode(error),
        }),
      );
    }
  }

  async findMany(query: FindAuditEventsQueryDto): Promise<AuditEventsPageDto> {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException('El inicio del rango no puede ser posterior al final.');
    }
    if (query.cursor && !(await this.repository.findById(query.cursor))) {
      throw new BadRequestException('El cursor de auditoría no existe.');
    }
    return this.repository.findMany({
      ...query,
      limit: query.limit ?? 50,
      from,
      to,
    });
  }

  private resolvePatientId(
    request: Request,
    policy: AuditPolicy,
    resourceType: string | null,
  ): string | null {
    const explicit = policy.patientParam
      ? this.validUuid(request.params?.[policy.patientParam])
      : null;
    if (explicit) return explicit;
    const nested = this.validUuid(request.params?.patientId);
    if (nested) return nested;
    return resourceType === 'PATIENT' ? this.validUuid(request.params?.id) : null;
  }

  private resolveResourceId(
    request: Request,
    policy: AuditPolicy,
    responseBody: unknown,
  ): string | null {
    if (policy.resourceParam) {
      return this.validUuid(request.params?.[policy.resourceParam]);
    }
    if (policy.resourceFromResponseId && this.isObject(responseBody)) {
      return this.validUuid(responseBody.id);
    }
    return (
      this.validUuid(request.params?.recordId) ??
      this.validUuid(request.params?.docId) ??
      this.validUuid(request.params?.assetId) ??
      this.validUuid(request.params?.id)
    );
  }

  private inferResourceType(route: string): string | null {
    if (route.includes('record-media')) return 'CLINICAL_MEDIA';
    if (route.includes('documents')) return 'MEDICAL_DOCUMENT';
    if (route.includes('records')) return 'CLINICAL_RECORD';
    if (route.includes('patients')) return 'PATIENT';
    if (route.includes('users')) return 'USER';
    if (route.includes('roles')) return 'ROLE';
    if (route.includes('audit')) return 'AUDIT_EVENT';
    return null;
  }

  private validUuid(value: unknown): string | null {
    return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
  }

  private validUsername(value: unknown): string | null {
    return typeof value === 'string' && USERNAME_PATTERN.test(value) ? value : null;
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private errorCode(error: unknown): string | null {
    if (!error || typeof error !== 'object' || !('code' in error)) return null;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code.slice(0, 32) : null;
  }
}
