import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DocumentStatus, RecordStatus, RecordType } from '@prisma/client';
import { IsClinicalDateFilter } from '../../../common/validation/clinical-date';

export class HistoryExportQueryDto {
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsClinicalDateFilter()
  from?: string;
  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsClinicalDateFilter()
  to?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() episodeId?: string;
  @ApiPropertyOptional({ enum: ['ALL', 'CURRENT'], default: 'ALL' })
  @IsOptional()
  @IsIn(['ALL', 'CURRENT'])
  versions?: 'ALL' | 'CURRENT';
}
export class HistorySearchQueryDto extends HistoryExportQueryDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  q?: string;
  @ApiPropertyOptional({ enum: ['RECORD', 'DOCUMENT'] })
  @IsOptional()
  @IsIn(['RECORD', 'DOCUMENT'])
  kind?: 'RECORD' | 'DOCUMENT';
  @ApiPropertyOptional({ enum: RecordType })
  @IsOptional()
  @IsEnum(RecordType)
  recordType?: RecordType;
  @ApiPropertyOptional({ enum: [...Object.values(RecordStatus), ...Object.values(DocumentStatus)] })
  @IsOptional()
  @IsIn([...Object.values(RecordStatus), ...Object.values(DocumentStatus)])
  status?: string;
  @ApiPropertyOptional({ enum: ['PENDING', 'CONFIRMED'] })
  @IsOptional()
  @IsIn(['PENDING', 'CONFIRMED'])
  confirmation?: 'PENDING' | 'CONFIRMED';
  @ApiPropertyOptional({ default: 1, maximum: 100000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;
}
export class HistoryEntryDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['RECORD', 'DOCUMENT'] }) kind: string;
  @ApiProperty() title: string;
  @ApiProperty() preview: string;
  @ApiProperty() status: string;
  @ApiPropertyOptional({ type: String, nullable: true }) recordType: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) clinicalFrom: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) clinicalTo: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) professional: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) service: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) specialty: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) episodeTitle: string | null;
  @ApiProperty() confirmed: boolean;
  @ApiProperty() createdAt: Date;
}
export class HistoryPageDto {
  @ApiProperty({ type: [HistoryEntryDto] }) data: HistoryEntryDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
export class HistoryOverviewDto {
  @ApiPropertyOptional({ type: Number, nullable: true }) pendingDocuments: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) activeRecords: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) recordVersions: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) pendingConfirmations: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) documents: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) validatedDocuments: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true }) openEpisodes: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) latestClinicalDate: string | null;
}
export class HistoryExportScopeDto {
  @ApiProperty({ enum: ['COMPLETE', 'FILTERED'] }) kind: string;
  @ApiProperty() description: string;
  @ApiProperty() includesSourceDocumentsOutsidePeriod: boolean;
}
