import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentStatus, DocumentType } from '@prisma/client';

export class GlobalPatientSearchResultDto {
  @ApiProperty() id: string;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty({ enum: DocumentType }) documentType: DocumentType;
  @ApiProperty() documentNumber: string;
}

export class GlobalDocumentPatientDto {
  @ApiProperty() id: string;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
}

export class GlobalDocumentSearchResultDto {
  @ApiProperty() id: string;
  @ApiProperty() patientId: string;
  @ApiProperty() originalName: string;
  @ApiProperty({ enum: DocumentStatus }) status: DocumentStatus;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ type: String, nullable: true }) snippet: string | null;
  @ApiPropertyOptional({ type: GlobalDocumentPatientDto, nullable: true })
  patient: GlobalDocumentPatientDto | null;
}

export class GlobalSearchCategoryDto<T> {
  data: T[];
  hasMore: boolean;
}

export class GlobalPatientSearchCategoryDto extends GlobalSearchCategoryDto<GlobalPatientSearchResultDto> {
  @ApiProperty({ type: [GlobalPatientSearchResultDto] }) data: GlobalPatientSearchResultDto[];
  @ApiProperty() hasMore: boolean;
}

export class GlobalDocumentSearchCategoryDto extends GlobalSearchCategoryDto<GlobalDocumentSearchResultDto> {
  @ApiProperty({ type: [GlobalDocumentSearchResultDto] }) data: GlobalDocumentSearchResultDto[];
  @ApiProperty() hasMore: boolean;
}

export class GlobalSearchResponseDto {
  @ApiProperty() query: string;
  @ApiProperty({ type: GlobalPatientSearchCategoryDto }) patients: GlobalPatientSearchCategoryDto;
  @ApiProperty({ type: GlobalDocumentSearchCategoryDto }) documents: GlobalDocumentSearchCategoryDto;
}
