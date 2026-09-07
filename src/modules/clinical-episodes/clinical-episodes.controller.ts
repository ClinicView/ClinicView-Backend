import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Audited } from '../audit/audit.decorator';
import { AUDIT_ACTIONS } from '../audit/audit-action';
import { ClinicalEpisodesService } from './clinical-episodes.service';
import {
  AssignEpisodeDto,
  CreateEpisodeDto,
  EpisodeDto,
  EpisodeEventsPageDto,
  EpisodePageQueryDto,
  EpisodesPageDto,
  EpisodeTransitionDto,
  UpdateEpisodeDto,
} from './episode.dto';

@ApiTags('clinical-episodes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('patients/:patientId')
export class ClinicalEpisodesController {
  constructor(private readonly service: ClinicalEpisodesService) {}
  @Get('episodes')
  @RequirePermissions('patients.read', 'records.read')
  @ApiResponse({ status: 200, type: EpisodesPageDto })
  list(@Param('patientId', ParseUUIDPipe) patientId: string, @Query() query: EpisodePageQueryDto) {
    return this.service.list(patientId, query);
  }
  @Post('episodes')
  @RequirePermissions('patients.read', 'records.read', 'records.create')
  @ApiResponse({ status: 201, type: EpisodeDto })
  @Audited(AUDIT_ACTIONS.EPISODE_CREATED, {
    resourceType: 'CLINICAL_EPISODE',
    patientParam: 'patientId',
    resourceFromResponseId: true,
  })
  create(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: CreateEpisodeDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.service.create(patientId, dto, req.user.sub);
  }
  @Patch('episodes/:id')
  @RequirePermissions('patients.read', 'records.read', 'records.create')
  @ApiResponse({ status: 200, type: EpisodeDto })
  @Audited(AUDIT_ACTIONS.EPISODE_UPDATED, {
    resourceType: 'CLINICAL_EPISODE',
    patientParam: 'patientId',
    resourceParam: 'id',
  })
  update(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEpisodeDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.service.update(patientId, id, dto, req.user.sub);
  }
  @Post('episodes/:id/transition')
  @RequirePermissions('patients.read', 'records.read', 'records.confirm')
  @ApiResponse({ status: 201, type: EpisodeDto })
  @Audited(AUDIT_ACTIONS.EPISODE_TRANSITIONED, {
    resourceType: 'CLINICAL_EPISODE',
    patientParam: 'patientId',
    resourceParam: 'id',
  })
  transition(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EpisodeTransitionDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.service.transition(patientId, id, dto, req.user.sub);
  }
  @Patch('records/:id/episode')
  @RequirePermissions('patients.read', 'records.read', 'records.create')
  @Audited(AUDIT_ACTIONS.EPISODE_RECORD_ASSIGNED, {
    resourceType: 'CLINICAL_RECORD',
    patientParam: 'patientId',
    resourceParam: 'id',
  })
  assign(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignEpisodeDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.service.assign(patientId, id, dto, req.user.sub);
  }
  @Get('episodes/:id/history')
  @RequirePermissions('patients.read', 'records.read')
  @ApiResponse({ status: 200, type: EpisodeEventsPageDto })
  history(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: EpisodePageQueryDto,
  ) {
    return this.service.history(patientId, id, query.page);
  }
}
