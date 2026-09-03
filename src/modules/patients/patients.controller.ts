import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { AUDIT_ACTIONS } from '../audit/audit-action';
import { Audited } from '../audit/audit.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatePatientDto } from './dto/create-patient.dto';
import { ClinicalHistoryExportResponseDto } from './dto/clinical-history-export-response.dto';
import { FindPatientsQueryDto } from './dto/find-patients-query.dto';
import { PatientResponseDto } from './dto/patient-response.dto';
import {
  DeletePatientRegistrationDraftQueryDto,
  PatientRegistrationDraftResponseDto,
  UpsertPatientRegistrationDraftDto,
} from './dto/patient-registration-draft.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PaginatedResponse, PatientsService } from './patients.service';

interface AuthRequest {
  user: { sub: string };
}

@ApiTags('patients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @Audited(AUDIT_ACTIONS.PATIENT_CREATED, {
    resourceType: 'PATIENT',
    resourceFromResponseId: true,
  })
  @RequirePermissions('patients.create')
  @ApiOperation({ summary: 'Registrar nuevo paciente' })
  @ApiResponse({ status: 201, type: PatientResponseDto })
  @ApiConflictResponse({ description: 'Ya existe un paciente con ese tipo y número de documento.' })
  create(
    @Body() dto: CreatePatientDto,
    @Request() request: AuthRequest,
  ): Promise<PatientResponseDto> {
    return this.patientsService.create(dto, request.user.sub);
  }

  @Get('draft/current')
  @RequirePermissions('patients.create')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({ summary: 'Obtener el borrador privado vigente del alta de paciente' })
  @ApiResponse({ status: 200, type: PatientRegistrationDraftResponseDto })
  @ApiResponse({ status: 204, description: 'No existe un borrador vigente.' })
  async getCurrentRegistrationDraft(
    @Request() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PatientRegistrationDraftResponseDto | null> {
    const draft = await this.patientsService.getCurrentRegistrationDraft(request.user.sub);
    if (!draft) response.status(HttpStatus.NO_CONTENT);
    return draft;
  }

  @Put('draft/current')
  @RequirePermissions('patients.create')
  @ApiOperation({ summary: 'Crear o reemplazar mediante CAS el borrador privado del alta' })
  @ApiResponse({ status: 200, type: PatientRegistrationDraftResponseDto })
  @ApiConflictResponse({ description: 'El borrador cambió, expiró o fue reemplazado.' })
  upsertCurrentRegistrationDraft(
    @Body() dto: UpsertPatientRegistrationDraftDto,
    @Request() request: AuthRequest,
  ): Promise<PatientRegistrationDraftResponseDto> {
    return this.patientsService.upsertCurrentRegistrationDraft(dto, request.user.sub);
  }

  @Delete('draft/current')
  @RequirePermissions('patients.create')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar mediante CAS el borrador privado del alta' })
  @ApiResponse({ status: 204 })
  @ApiConflictResponse({ description: 'El borrador cambió o fue reemplazado.' })
  async deleteCurrentRegistrationDraft(
    @Query() query: DeletePatientRegistrationDraftQueryDto,
    @Request() request: AuthRequest,
  ): Promise<void> {
    await this.patientsService.deleteCurrentRegistrationDraft(
      query.draftId,
      query.expectedVersion,
      request.user.sub,
    );
  }

  @Get()
  @RequirePermissions('patients.read')
  @ApiOperation({
    summary: 'Listar pacientes activos — con búsqueda por nombre/documento y paginación',
  })
  @ApiResponse({ status: 200 })
  findAll(@Query() query: FindPatientsQueryDto): Promise<PaginatedResponse<PatientResponseDto>> {
    return this.patientsService.findAll(query);
  }

  @Get('stats')
  @RequirePermissions('patients.read')
  @ApiOperation({
    summary: 'Indicadores de la lista de pacientes (total, activos, nuevos, con documentos)',
  })
  stats() {
    return this.patientsService.stats();
  }

  @Get(':id/clinical-history/export')
  @Audited(AUDIT_ACTIONS.CLINICAL_HISTORY_EXPORTED, {
    resourceType: 'PATIENT',
    patientParam: 'id',
    resourceParam: 'id',
  })
  @RequirePermissions('patients.read', 'records.read', 'documents.read')
  @Header('Cache-Control', 'private, no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @ApiOperation({
    summary: 'Obtener la historia clínica completa para exportación',
    description:
      'Devuelve todos los registros, incluidos corregidos y anulados, y todos los documentos con su estado. El texto de documentos no validados se omite.',
  })
  @ApiResponse({ status: 200, type: ClinicalHistoryExportResponseDto })
  @ApiForbiddenResponse({
    description: 'Requiere patients.read, records.read y documents.read.',
  })
  @ApiNotFoundResponse({ description: 'Paciente no encontrado.' })
  exportClinicalHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() request: AuthRequest,
  ): Promise<ClinicalHistoryExportResponseDto> {
    return this.patientsService.exportClinicalHistory(id, request.user.sub);
  }

  @Get(':id')
  @Audited(AUDIT_ACTIONS.PATIENT_VIEWED, {
    resourceType: 'PATIENT',
    patientParam: 'id',
    resourceParam: 'id',
  })
  @RequirePermissions('patients.read')
  @ApiOperation({ summary: 'Obtener paciente por ID' })
  @ApiResponse({ status: 200, type: PatientResponseDto })
  @ApiNotFoundResponse({ description: 'Paciente no encontrado.' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PatientResponseDto> {
    return this.patientsService.findOne(id);
  }

  @Patch(':id')
  @Audited(AUDIT_ACTIONS.PATIENT_UPDATED, {
    resourceType: 'PATIENT',
    patientParam: 'id',
    resourceParam: 'id',
  })
  @RequirePermissions('patients.update')
  @ApiOperation({ summary: 'Actualizar datos demográficos del paciente' })
  @ApiResponse({ status: 200, type: PatientResponseDto })
  @ApiNotFoundResponse({ description: 'Paciente no encontrado.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePatientDto,
  ): Promise<PatientResponseDto> {
    return this.patientsService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Audited(AUDIT_ACTIONS.PATIENT_DEACTIVATED, {
    resourceType: 'PATIENT',
    patientParam: 'id',
    resourceParam: 'id',
  })
  @RequirePermissions('patients.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desactivar paciente (borrado lógico)' })
  @ApiResponse({ status: 200, type: PatientResponseDto })
  @ApiNotFoundResponse({ description: 'Paciente no encontrado.' })
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<PatientResponseDto> {
    return this.patientsService.deactivate(id);
  }

  @Patch(':id/activate')
  @Audited(AUDIT_ACTIONS.PATIENT_ACTIVATED, {
    resourceType: 'PATIENT',
    patientParam: 'id',
    resourceParam: 'id',
  })
  @RequirePermissions('patients.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivar paciente desactivado' })
  @ApiResponse({ status: 200, type: PatientResponseDto })
  @ApiNotFoundResponse({ description: 'Paciente no encontrado.' })
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<PatientResponseDto> {
    return this.patientsService.activate(id);
  }
}
