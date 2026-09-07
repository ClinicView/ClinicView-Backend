import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { Audited } from '../audit/audit.decorator';
import { AUDIT_ACTIONS } from '../audit/audit-action';
import { DocumentMetadataService } from './document-metadata.service';
import { DocumentMetadataUpdateResponseDto } from './dto/document-metadata.dto';
import {
  DocumentMetadataRevisionDto,
  UpdateDocumentMetadataDto,
} from './dto/document-metadata.dto';

class MetadataHistoryQueryDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  beforeVersion?: number;
}
class MetadataHistoryPageDto {
  @ApiProperty({ type: [DocumentMetadataRevisionDto] }) data: DocumentMetadataRevisionDto[];
  @ApiProperty({ type: Number, nullable: true }) nextBeforeVersion: number | null;
}

@ApiTags('document-metadata')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('patients/:patientId/documents/:documentId/metadata')
export class DocumentMetadataController {
  constructor(private readonly service: DocumentMetadataService) {}

  @Get('history')
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions('documents.read', 'patients.read')
  @Audited(AUDIT_ACTIONS.DOCUMENT_VIEWED, {
    resourceType: 'MEDICAL_DOCUMENT',
    patientParam: 'patientId',
    resourceParam: 'documentId',
  })
  @ApiResponse({ status: 200, type: MetadataHistoryPageDto })
  history(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Query() query: MetadataHistoryQueryDto,
  ) {
    return this.service.history(patientId, documentId, query.beforeVersion);
  }

  @Patch()
  @ApiResponse({ status: 200, type: DocumentMetadataUpdateResponseDto })
  @RequirePermissions('patients.read', 'documents.read', 'documents.validate')
  @Audited(AUDIT_ACTIONS.DOCUMENT_METADATA_UPDATED, {
    resourceType: 'MEDICAL_DOCUMENT',
    patientParam: 'patientId',
    resourceParam: 'documentId',
  })
  update(
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Body() dto: UpdateDocumentMetadataDto,
    @Request() req: { user: { sub: string } },
  ) {
    return this.service.update(patientId, documentId, dto, req.user.sub);
  }
}
