import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatePatientDto } from './dto/create-patient.dto';
import { ClinicalHistoryExportResponseDto } from './dto/clinical-history-export-response.dto';
import { FindPatientsQueryDto } from './dto/find-patients-query.dto';
import { PatientResponseDto } from './dto/patient-response.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { PaginatedResponse, PatientsService } from './patients.service';

@ApiTags('patients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Post()
  @RequirePermissions('patients.create')
  @ApiOperation({ summary: 'Registrar nuevo paciente' })
  @ApiResponse({ status: 201, type: PatientResponseDto })
  @ApiConflictResponse({ description: 'Ya existe un paciente con ese tipo y número de documento.' })
  create(@Body() dto: CreatePatientDto): Promise<PatientResponseDto> {
    return this.patientsService.create(dto);
  }

  @Get()
  @RequirePermissions('patients.read')
  @ApiOperation({
    summary: 'Listar pacientes activos — con búsqueda por nombre/documento y paginación',
  })
  @ApiResponse({ status: 200 })
  findAll(
    @Query() query: FindPatientsQueryDto,
  ): Promise<PaginatedResponse<PatientResponseDto>> {
    return this.patientsService.findAll(query);
  }

  @Get('stats')
  @RequirePermissions('patients.read')
  @ApiOperation({ summary: 'Indicadores de la lista de pacientes (total, activos, nuevos, con documentos)' })
  stats() {
    return this.patientsService.stats();
  }

  @Get(':id/clinical-history/export')
  @RequirePermissions('patients.read', 'records.read', 'documents.read')
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
  ): Promise<ClinicalHistoryExportResponseDto> {
    return this.patientsService.exportClinicalHistory(id);
  }

  @Get(':id')
  @RequirePermissions('patients.read')
  @ApiOperation({ summary: 'Obtener paciente por ID' })
  @ApiResponse({ status: 200, type: PatientResponseDto })
  @ApiNotFoundResponse({ description: 'Paciente no encontrado.' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<PatientResponseDto> {
    return this.patientsService.findOne(id);
  }

  @Patch(':id')
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
  @RequirePermissions('patients.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desactivar paciente (borrado lógico)' })
  @ApiResponse({ status: 200, type: PatientResponseDto })
  @ApiNotFoundResponse({ description: 'Paciente no encontrado.' })
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<PatientResponseDto> {
    return this.patientsService.deactivate(id);
  }

  @Patch(':id/activate')
  @RequirePermissions('patients.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivar paciente desactivado' })
  @ApiResponse({ status: 200, type: PatientResponseDto })
  @ApiNotFoundResponse({ description: 'Paciente no encontrado.' })
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<PatientResponseDto> {
    return this.patientsService.activate(id);
  }
}
