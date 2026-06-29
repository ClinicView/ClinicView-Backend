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
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { MedicalDocumentsService } from './medical-documents.service';
import { CorrectDocumentDto } from './dto/correct-document.dto';
import { DocumentResponseDto } from './dto/document-response.dto';
import { FindDocumentsQueryDto } from './dto/find-documents-query.dto';
import { RejectDocumentDto } from './dto/reject-document.dto';

const DEFAULT_UPLOAD_MAX_SIZE_MB = 20;

interface AuthRequest {
  user?: { sub?: string };
}

function getUploadMaxSizeBytes(): number {
  const configured = Number.parseInt(
    process.env.UPLOAD_MAX_SIZE_MB ?? String(DEFAULT_UPLOAD_MAX_SIZE_MB),
    10,
  );
  const sizeMb = Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_UPLOAD_MAX_SIZE_MB;
  return sizeMb * 1024 * 1024;
}

@ApiTags('medical-documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('patients/:patientId/documents')
export class MedicalDocumentsController {
  constructor(private readonly service: MedicalDocumentsService) {}

  @Post()
  @RequirePermissions('documents.upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: getUploadMaxSizeBytes() },
  }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Subir documento medico (PDF, JPEG, PNG; maximo configurable por UPLOAD_MAX_SIZE_MB)' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: DocumentResponseDto })
  upload(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: AuthRequest,
  ): Promise<DocumentResponseDto> {
    return this.service.upload(patientId, file, req.user?.sub);
  }

  @Get()
  @RequirePermissions('documents.read')
  @ApiOperation({ summary: 'Listar documentos de un paciente' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  findAll(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: FindDocumentsQueryDto,
  ) {
    return this.service.findByPatient(patientId, query);
  }

  @Get(':id')
  @RequirePermissions('documents.read')
  @ApiOperation({ summary: 'Obtener metadatos de un documento' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: DocumentResponseDto })
  findOne(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DocumentResponseDto> {
    return this.service.findOne(patientId, id);
  }

  @Get(':id/file')
  @RequirePermissions('documents.read')
  @ApiOperation({ summary: 'Descargar / visualizar el archivo del documento' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  async downloadFile(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { document, stream } = await this.service.getFile(patientId, id);
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(document.originalName)}"`,
    });
    return new StreamableFile(stream);
  }

  @Post(':id/process')
  @RequirePermissions('documents.upload')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar documento al worker de OCR/NER' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: DocumentResponseDto })
  process(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthRequest,
  ): Promise<DocumentResponseDto> {
    return this.service.process(patientId, id, req.user?.sub);
  }

  @Patch(':id/validate')
  @RequirePermissions('documents.validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validar documento procesado (revisiÃ³n clÃ­nica)' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: DocumentResponseDto })
  validate(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: AuthRequest,
  ): Promise<DocumentResponseDto> {
    return this.service.validate(patientId, id, req.user?.sub);
  }

  @Patch(':id/correction')
  @RequirePermissions('documents.validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Guardar correccion de OCR/entidades sin sobrescribir el original' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: DocumentResponseDto })
  saveCorrection(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectDocumentDto,
    @Request() req: AuthRequest,
  ): Promise<DocumentResponseDto> {
    return this.service.saveCorrection(patientId, id, dto, req.user?.sub);
  }

  @Patch(':id/reject')
  @RequirePermissions('documents.reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rechazar documento (con motivo)' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: DocumentResponseDto })
  reject(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDocumentDto,
    @Request() req: AuthRequest,
  ): Promise<DocumentResponseDto> {
    return this.service.reject(patientId, id, dto, req.user?.sub);
  }
}

