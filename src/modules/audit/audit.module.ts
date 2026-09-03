import { Module } from '@nestjs/common';
import { AuditContextGuard } from './audit-context.guard';
import { AuditController } from './audit.controller';
import { AuditExceptionFilter } from './audit-exception.filter';
import { AuditTrailInterceptor } from './audit.interceptor';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [
    AuditRepository,
    AuditService,
    AuditContextGuard,
    AuditTrailInterceptor,
    AuditExceptionFilter,
  ],
  exports: [AuditService, AuditContextGuard, AuditTrailInterceptor, AuditExceptionFilter],
})
export class AuditModule {}
