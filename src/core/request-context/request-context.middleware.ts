import { createHmac, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { RequestContextService } from './request-context.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class RequestContextMiddleware {
  private readonly hashSecret: string;

  constructor(
    private readonly requestContext: RequestContextService,
    configService: ConfigService,
  ) {
    const configured = configService.get<string>('audit.hashSecret')?.trim();
    const nodeEnv = configService.get<string>('nodeEnv', 'development');
    if (nodeEnv === 'production' && (!configured || configured.length < 32)) {
      throw new Error('AUDIT_HASH_SECRET must contain at least 32 characters in production.');
    }
    this.hashSecret = configured || 'clinicview-development-audit-hmac-secret';
  }

  use(request: Request, response: Response, next: NextFunction): void {
    const incomingId = headerValue(request.headers['x-request-id']);
    const requestId = incomingId && UUID_PATTERN.test(incomingId) ? incomingId : randomUUID();
    response.setHeader('X-Request-Id', requestId);

    this.requestContext.run(
      {
        requestId,
        startedAt: Date.now(),
        ipHash: this.hash(request.ip || request.socket.remoteAddress),
        userAgentHash: this.hash(headerValue(request.headers['user-agent'])),
        method: request.method.toUpperCase().slice(0, 8),
        route: 'UNRESOLVED',
        auditPolicy: null,
        actorId: null,
        actorUsernameAtEvent: null,
        skipAudit: false,
      },
      next,
    );
  }

  private hash(value: string | undefined): string | null {
    if (!value) return null;
    return createHmac('sha256', this.hashSecret).update(value).digest('hex');
  }
}
