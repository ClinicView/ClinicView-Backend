import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { Audited } from '../audit/audit.decorator';
import { AUDIT_ACTIONS } from '../audit/audit-action';
import { ClinicalSummaryResponseDto, SaveClinicalSummaryDto } from './dto/clinical-summary.dto';
import { ClinicalSummaryService } from './clinical-summary.service';

class SummaryHistoryQueryDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeVersion?: number;
}

@ApiTags('patient-clinical-summary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('patients/:patientId/clinical-summary')
export class ClinicalSummaryController {
  constructor(private readonly service: ClinicalSummaryService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions('patients.read', 'records.read')
  @Audited(AUDIT_ACTIONS.CLINICAL_SUMMARY_VIEWED, {
    resourceType: 'PATIENT',
    patientParam: 'patientId',
    resourceParam: 'patientId',
  })
  @ApiResponse({ status: 200, type: ClinicalSummaryResponseDto })
  current(@Param('patientId', ParseUUIDPipe) patientId: string) {
    return this.service.current(patientId);
  }

  @Get('history')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions('patients.read', 'records.read')
  @Audited(AUDIT_ACTIONS.CLINICAL_SUMMARY_VIEWED, {
    resourceType: 'PATIENT',
    patientParam: 'patientId',
    resourceParam: 'patientId',
  })
  history(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: SummaryHistoryQueryDto,
  ) {
    return this.service.history(patientId, query.beforeVersion);
  }

  @Put()
  @RequirePermissions('patients.read', 'records.read', 'records.create')
  @Audited(AUDIT_ACTIONS.CLINICAL_SUMMARY_UPDATED, {
    resourceType: 'PATIENT',
    patientParam: 'patientId',
    resourceParam: 'patientId',
  })
  @ApiResponse({ status: 200, type: ClinicalSummaryResponseDto })
  save(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: SaveClinicalSummaryDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.service.save(patientId, dto, req.user.sub);
  }
}
