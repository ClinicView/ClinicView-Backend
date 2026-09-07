import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { CreateRecordDto } from './create-record.dto';

export class PublishRecordDto extends CreateRecordDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() sourceDocumentId: string;
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedDocumentVersion: number;
  @ApiProperty({ minimum: 1, maximum: 5000 }) @IsInt() @Min(1) @Max(5000) pageFrom: number;
  @ApiProperty({ minimum: 1, maximum: 5000 }) @IsInt() @Min(1) @Max(5000) pageTo: number;
  @ApiProperty({ maxLength: 1000, minLength: 5 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  sourceNote: string;
  @ApiProperty({ enum: [true] }) @Equals(true) sourceVerified: boolean;
  @ApiProperty({
    format: 'uuid',
    description: 'Identificador del intento; evita duplicados por reenvío.',
  })
  @IsUUID()
  publicationKey: string;
}

export class RecordSourceDto {
  @ApiProperty() documentId: string;
  @ApiProperty() documentVersion: number;
  @ApiProperty() documentName: string;
  @ApiProperty({ type: Object }) documentMetadata: Record<string, unknown>;
  @ApiProperty() pageFrom: number;
  @ApiProperty() pageTo: number;
  @ApiProperty() sourceNote: string;
  @ApiProperty() publishedBy: string;
  @ApiProperty() publishedByName: string;
  @ApiProperty() publishedAt: Date;
}
