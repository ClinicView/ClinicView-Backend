import { ArgumentsHost, HttpException, Injectable } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { AuditOutcome } from '@prisma/client';
import type { Request } from 'express';
import { RequestContextService } from '../../core/request-context/request-context.service';
import { AuditService } from './audit.service';

@Injectable()
export class AuditExceptionFilter extends BaseExceptionFilter {
  constructor(
    adapterHost: HttpAdapterHost,
    private readonly auditService: AuditService,
    private readonly requestContext: RequestContextService,
  ) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      super.catch(exception, host);
      return;
    }
    void this.recordThenReply(exception, host);
  }

  private async recordThenReply(exception: unknown, host: ArgumentsHost): Promise<void> {
    const request = host.switchToHttp().getRequest<Request & { user?: { sub?: unknown } }>();
    const actorId = request.user?.sub;
    this.requestContext.setActor(typeof actorId === 'string' ? actorId : null);
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const outcome = status === 401 || status === 403 ? AuditOutcome.DENIED : AuditOutcome.FAILED;
    await this.auditService.recordHttp(request, outcome, status);
    super.catch(exception, host);
  }
}
