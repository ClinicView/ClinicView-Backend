import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ClinicalMediaStatus } from '@prisma/client';

export const MAX_RECORD_ATTACHMENTS = 10;
export const MAX_RECORD_ATTACHMENTS_BYTES = 30 * 1024 * 1024;
export const MAX_ATTACHMENT_CAPTION_LENGTH = 500;
export const MAX_ATTACHMENT_ALT_TEXT_LENGTH = 500;
export const MAX_ATTACHMENT_SECTION_KEY_LENGTH = 64;

export function buildClinicalMediaContentUrl(patientId: string, assetId: string): string {
  return `/patients/${patientId}/record-media/${assetId}/content`;
}

const trimOptionalText = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export class RecordAttachmentInputDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  assetId: string;

  @ApiPropertyOptional({
    maxLength: MAX_ATTACHMENT_SECTION_KEY_LENGTH,
    pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,63}$',
    example: 'physicalExam',
  })
  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(MAX_ATTACHMENT_SECTION_KEY_LENGTH)
  @Matches(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/)
  sectionKey?: string;

  @ApiPropertyOptional({ maxLength: MAX_ATTACHMENT_CAPTION_LENGTH })
  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(MAX_ATTACHMENT_CAPTION_LENGTH)
  caption?: string;

  @ApiPropertyOptional({
    maxLength: MAX_ATTACHMENT_ALT_TEXT_LENGTH,
    description: 'Descripción accesible de la imagen clínica.',
  })
  @IsOptional()
  @Transform(trimOptionalText)
  @IsString()
  @MaxLength(MAX_ATTACHMENT_ALT_TEXT_LENGTH)
  altText?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_RECORD_ATTACHMENTS - 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RECORD_ATTACHMENTS - 1)
  sortOrder?: number;
}

export function RecordAttachmentsValidation(): PropertyDecorator {
  return (target, propertyKey) => {
    ValidateIf((_object, value: unknown) => value !== undefined)(target, propertyKey);
    IsArray()(target, propertyKey);
    ArrayMaxSize(MAX_RECORD_ATTACHMENTS)(target, propertyKey);
    ArrayUnique((attachment: RecordAttachmentInputDto) => attachment?.assetId)(target, propertyKey);
    ValidateNested({ each: true })(target, propertyKey);
    Type(() => RecordAttachmentInputDto)(target, propertyKey);
  };
}

export class ClinicalMediaAssetResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String, format: 'uuid' }) patientId: string;
  @ApiProperty() originalName: string;
  @ApiProperty({ enum: ['image/jpeg', 'image/png'] }) mimeType: string;
  @ApiProperty({ minimum: 1, maximum: 10 * 1024 * 1024 }) sizeBytes: number;
  @ApiProperty({ minimum: 1, maximum: 10000 }) width: number;
  @ApiProperty({ minimum: 1, maximum: 10000 }) height: number;
  @ApiProperty({ pattern: '^[0-9a-f]{64}$' }) sha256: string;
  @ApiProperty({ enum: ClinicalMediaStatus }) status: ClinicalMediaStatus;
  @ApiPropertyOptional({ type: Date, nullable: true }) expiresAt: Date | null;
  @ApiProperty({ minimum: 0 }) version: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ example: '/patients/:patientId/record-media/:assetId/content' })
  contentUrl: string;
}

export class ClinicalRecordAttachmentResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String, format: 'uuid' }) assetId: string;
  @ApiPropertyOptional({ type: String, nullable: true }) sectionKey: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) caption: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) altText: string | null;
  @ApiProperty({ minimum: 0, maximum: MAX_RECORD_ATTACHMENTS - 1 }) sortOrder: number;
  @ApiProperty({ type: String, format: 'uuid' }) createdBy: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: ClinicalMediaAssetResponseDto }) asset: ClinicalMediaAssetResponseDto;
}
