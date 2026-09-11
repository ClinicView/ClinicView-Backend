import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
  Request,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { Audited } from '../audit/audit.decorator';
import { AUDIT_ACTIONS } from '../audit/audit-action';
import { SaveOcrLayoutReviewDto } from './dto/ocr-layout-review.dto';
import { OcrLayoutService } from './ocr-layout.service';

@ApiTags('medical-documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('patients/:patientId/documents/:id/ocr-layout')
export class OcrLayoutController {
  constructor(private readonly service: OcrLayoutService) {}

  @Get()
  @RequirePermissions('documents.read')
  @Audited(AUDIT_ACTIONS.DOCUMENT_OCR_LAYOUT_VIEWED, {
    resourceType: 'MEDICAL_DOCUMENT',
    patientParam: 'patientId',
    resourceParam: 'id',
  })
  @ApiOperation({ summary: 'Obtener geometría original y última revisión espacial OCR' })
  getLayout(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getLayout(patientId, id);
  }

  @Patch('review')
  @RequirePermissions('documents.validate')
  @Audited(AUDIT_ACTIONS.DOCUMENT_OCR_REVIEW_SAVED, {
    resourceType: 'MEDICAL_DOCUMENT',
    patientParam: 'patientId',
    resourceParam: 'id',
  })
  @ApiOperation({
    summary: 'Guardar revisión espacial y texto corregido atómicamente, sin validar clínicamente',
  })
  saveReview(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveOcrLayoutReviewDto,
    @Request() request: { user: { sub: string } },
  ) {
    return this.service.saveReview(patientId, id, dto, request.user.sub);
  }

  @Get('reviews/:revision')
  @RequirePermissions('documents.read')
  @Audited(AUDIT_ACTIONS.DOCUMENT_OCR_LAYOUT_VIEWED, {
    resourceType: 'MEDICAL_DOCUMENT',
    patientParam: 'patientId',
    resourceParam: 'id',
  })
  @ApiOperation({ summary: 'Consultar una revisión histórica inmutable de una ejecución OCR' })
  getRevision(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('revision', ParseIntPipe) revision: number,
    @Query('runId') runId: string,
  ) {
    return this.service.getRevision(patientId, id, runId, revision);
  }

  @Get('pages/:page/image')
  @RequirePermissions('documents.read')
  @Audited(AUDIT_ACTIONS.DOCUMENT_OCR_PAGE_VIEWED, {
    resourceType: 'MEDICAL_DOCUMENT',
    patientParam: 'patientId',
    resourceParam: 'id',
  })
  @ApiOperation({ summary: 'Obtener la página preservada privada de la ejecución OCR indicada' })
  async getPageImage(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('page', ParseIntPipe) page: number,
    @Query('runId') runId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const bytes = await this.service.getPageImage(patientId, id, runId, page);
    response.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="ocr-page-${page}.png"`,
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(bytes);
  }
}
