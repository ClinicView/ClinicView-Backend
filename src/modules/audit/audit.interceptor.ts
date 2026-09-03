import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { AuditOutcome } from '@prisma/client';
import type { Request, Response } from 'express';
import { mergeMap, Observable } from 'rxjs';
import { AuditService } from './audit.service';

@Injectable()
export class AuditTrailInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      mergeMap(async (responseBody: unknown) => {
        await this.auditService.recordHttp(
          request,
          AuditOutcome.SUCCESS,
          response.statusCode,
          responseBody,
        );
        return responseBody;
      }),
    );
  }
}
