import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { RequestContextService } from '../../core/request-context/request-context.service';
import {
  AUDIT_POLICY_KEY,
  type AuditPolicy,
  SKIP_AUDIT_KEY,
} from './audit.decorator';

@Injectable()
export class AuditContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly requestContext: RequestContextService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request>();
    const skipAudit = this.reflector.getAllAndOverride<boolean>(SKIP_AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const configured = this.reflector.getAllAndOverride<AuditPolicy>(AUDIT_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const policy: AuditPolicy = configured ?? {
      action: `HTTP_${request.method.toUpperCase().slice(0, 48)}`,
    };
    const route = this.safeRoute(request, context);
    this.requestContext.setAuditPolicy(policy, route, Boolean(skipAudit));
    return true;
  }

  private safeRoute(request: Request, context: ExecutionContext): string {
    const routePath = (request.route as { path?: unknown } | undefined)?.path;
    if (typeof routePath === 'string' && !routePath.includes('?') && routePath.length <= 160) {
      return routePath;
    }
    return `${context.getClass().name}.${context.getHandler().name}`.slice(0, 160);
  }
}
