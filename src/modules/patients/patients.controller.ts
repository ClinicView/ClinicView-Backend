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
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreatePatientDto } from './dto/create-patient.dto';
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
}
