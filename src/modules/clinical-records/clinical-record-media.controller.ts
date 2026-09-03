import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { AUDIT_ACTIONS } from '../audit/audit-action';
import { Audited } from '../audit/audit.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ClinicalRecordMediaService,
  MAX_RECORD_MEDIA_FILE_BYTES,
} from './clinical-record-media.service';
import { ClinicalMediaAssetResponseDto } from './dto/record-attachment.dto';
import { DeleteRecordMediaQueryDto } from './dto/record-media.dto';

interface AuthRequest {
  user: { sub: string };
}

function safeContentDisposition(filename: string): string {
  const ascii = filename
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/["\\]/g, '_')
    .replace(/[\r\n]/g, '')
    .trim()
    .slice(0, 180);
  const fallback = ascii || 'imagen-clinica';
  const unicodeSafe = Buffer.from(filename, 'utf8').toString('utf8');
  const encoded = encodeURIComponent(unicodeSafe).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

@ApiTags('clinical-record-media')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('patients/:patientId/record-media')
export class ClinicalRecordMediaController {
  constructor(private readonly service: ClinicalRecordMediaService) {}

  @Post()
  @Audited(AUDIT_ACTIONS.CLINICAL_MEDIA_UPLOADED, {
    resourceType: 'CLINICAL_MEDIA',
    patientParam: 'patientId',
    resourceFromResponseId: true,
  })
  @RequirePermissions('records.create')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_RECORD_MEDIA_FILE_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'JPEG o PNG real; máximo 10 MiB y 25 megapíxeles.',
        },
      },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Subir y normalizar una imagen clínica temporal privada' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: ClinicalMediaAssetResponseDto })
  @ApiResponse({ status: 413, description: 'La imagen supera los límites permitidos.' })
  upload(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() request: AuthRequest,
  ): Promise<ClinicalMediaAssetResponseDto> {
    return this.service.upload(patientId, file, request.user.sub);
  }

  @Get(':assetId')
  @Audited(AUDIT_ACTIONS.CLINICAL_MEDIA_VIEWED, {
    resourceType: 'CLINICAL_MEDIA',
    patientParam: 'patientId',
    resourceParam: 'assetId',
  })
  @RequirePermissions('records.read')
  @ApiOperation({ summary: 'Obtener metadata segura de una imagen clínica' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'assetId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ClinicalMediaAssetResponseDto })
  getMetadata(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Request() request: AuthRequest,
  ): Promise<ClinicalMediaAssetResponseDto> {
    return this.service.getMetadata(patientId, assetId, request.user.sub);
  }

  @Get(':assetId/content')
  @Audited(AUDIT_ACTIONS.CLINICAL_MEDIA_DOWNLOADED, {
    resourceType: 'CLINICAL_MEDIA',
    patientParam: 'patientId',
    resourceParam: 'assetId',
  })
  @RequirePermissions('records.read')
  @ApiOperation({ summary: 'Visualizar el contenido privado de una imagen clínica' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'assetId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    schema: { type: 'string', format: 'binary' },
    headers: {
      'Cache-Control': { schema: { type: 'string', example: 'private, no-store' } },
      'X-Content-Type-Options': { schema: { type: 'string', example: 'nosniff' } },
    },
  })
  async getContent(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Request() request: AuthRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { asset, content, filename } = await this.service.getContent(
      patientId,
      assetId,
      request.user.sub,
    );
    response.set({
      'Content-Type': asset.mimeType,
      'Content-Length': String(content.length),
      'Content-Disposition': safeContentDisposition(filename),
      'Cache-Control': 'private, no-store',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(content);
  }

  @Delete(':assetId')
  @Audited(AUDIT_ACTIONS.CLINICAL_MEDIA_DELETED, {
    resourceType: 'CLINICAL_MEDIA',
    patientParam: 'patientId',
    resourceParam: 'assetId',
  })
  @RequirePermissions('records.create')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar con CAS una imagen temporal propia' })
  @ApiParam({ name: 'patientId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'assetId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 409, description: 'Versión obsoleta o imagen ya adjunta.' })
  async deleteTemporary(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Query() query: DeleteRecordMediaQueryDto,
    @Request() request: AuthRequest,
  ): Promise<void> {
    await this.service.deleteTemporary(patientId, assetId, query.expectedVersion, request.user.sub);
  }
}
