import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { Audited } from '../audit/audit.decorator';
import { AUDIT_ACTIONS } from '../audit/audit-action';
import { ClinicalHistoryService } from './clinical-history.service';
import { HistoryOverviewDto, HistoryPageDto, HistorySearchQueryDto } from './dto/history-query.dto';
@ApiTags('clinical-history')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('patients.read')
@Controller('patients/:patientId/clinical-history')
export class ClinicalHistoryController {
  constructor(private readonly service: ClinicalHistoryService) {}
  @Get('search')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, type: HistoryPageDto })
  @Audited(AUDIT_ACTIONS.CLINICAL_HISTORY_SEARCHED, {
    resourceType: 'PATIENT',
    patientParam: 'patientId',
    resourceParam: 'patientId',
  })
  search(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: HistorySearchQueryDto,
    @Request() req: { user: { permissions: string[] } },
  ) {
    return this.service.search(patientId, query, req.user.permissions);
  }
  @Get('overview')
  @Header('Cache-Control', 'private, no-store')
  @ApiResponse({ status: 200, type: HistoryOverviewDto })
  overview(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Request() req: { user: { permissions: string[] } },
  ) {
    return this.service.overview(patientId, req.user.permissions);
  }
}
