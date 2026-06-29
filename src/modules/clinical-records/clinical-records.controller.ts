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
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { ClinicalRecordsService } from './clinical-records.service';
import { CorrectRecordDto } from './dto/correct-record.dto';
import { CreateRecordDto } from './dto/create-record.dto';
import { FindRecordsQueryDto } from './dto/find-records-query.dto';
import { RecordResponseDto } from './dto/record-response.dto';
import { VoidRecordDto } from './dto/void-record.dto';

interface AuthRequest {
  user?: { sub?: string };
}

@ApiTags('clinical-records')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('patients/:patientId/records')
export class ClinicalRecordsController {
  constructor(private readonly service: ClinicalRecordsService) {}

  @Post()
  @RequirePermissions('records.create')
  @ApiOperation({ summary: 'Crear historia clínica para un paciente' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: RecordResponseDto })
  create(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: CreateRecordDto,
    @Request() req: AuthRequest,
  ): Promise<RecordResponseDto> {
    return this.service.create(patientId, dto, req.user?.sub);
  }

  @Get()
  @RequirePermissions('records.read')
  @ApiOperation({ summary: 'Listar historias clínicas de un paciente' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200 })
  findAll(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: FindRecordsQueryDto,
  ) {
    return this.service.findByPatient(patientId, query);
  }

  @Get(':id')
  @RequirePermissions('records.read')
  @ApiOperation({ summary: 'Obtener una historia clínica por ID' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: RecordResponseDto })
  findOne(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RecordResponseDto> {
    return this.service.findOne(patientId, id);
  }

  @Post(':id/correct')
  @RequirePermissions('records.correct')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Emitir corrección sobre una historia clínica activa' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: RecordResponseDto })
  correct(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectRecordDto,
    @Request() req: AuthRequest,
  ): Promise<RecordResponseDto> {
    return this.service.correct(patientId, id, dto, req.user?.sub);
  }

  @Patch(':id/void')
  @RequirePermissions('records.void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anular una historia clínica activa' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: RecordResponseDto })
  void(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidRecordDto,
    @Request() req: AuthRequest,
  ): Promise<RecordResponseDto> {
    return this.service.void(patientId, id, dto, req.user?.sub);
  }
}
