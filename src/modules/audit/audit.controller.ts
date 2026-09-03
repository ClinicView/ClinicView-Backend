import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AUDIT_ACTIONS } from './audit-action';
import { Audited } from './audit.decorator';
import { AuditService } from './audit.service';
import { AuditEventsPageDto } from './dto/audit-event-response.dto';
import { FindAuditEventsQueryDto } from './dto/find-audit-events-query.dto';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('events')
  @RequirePermissions('admin.audit.read')
  @Audited(AUDIT_ACTIONS.AUDIT_EVENTS_VIEWED, { resourceType: 'AUDIT_EVENT' })
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({ summary: 'Consultar eventos técnicos de auditoría append-only' })
  @ApiResponse({ status: 200, type: AuditEventsPageDto })
  @ApiForbiddenResponse({ description: 'Requiere admin.audit.read.' })
  findMany(@Query() query: FindAuditEventsQueryDto): Promise<AuditEventsPageDto> {
    return this.auditService.findMany(query);
  }
}
