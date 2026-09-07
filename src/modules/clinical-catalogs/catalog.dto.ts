import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export class CatalogQueryDto {
  @ApiPropertyOptional({ enum: ['SERVICE', 'SPECIALTY'] })
  @IsOptional()
  @IsIn(['SERVICE', 'SPECIALTY'])
  kind?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ALL'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ALL'])
  status?: string;
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  q?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}
export class CreateCatalogEntryDto {
  @ApiProperty({ enum: ['SERVICE', 'SPECIALTY'] }) @IsIn(['SERVICE', 'SPECIALTY']) kind: string;
  @ApiProperty({ maxLength: 40 }) @Transform(trim) @Matches(/^[A-Z0-9_-]{2,40}$/) code: string;
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;
}
export class UpdateCatalogEntryDto {
  @ApiProperty() @IsInt() @Min(0) expectedVersion: number;
  @ApiProperty({ maxLength: 120 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;
  @ApiProperty() @IsBoolean() isActive: boolean;
}
export class CatalogEntryDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['SERVICE', 'SPECIALTY'] }) kind: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty() isActive: boolean;
  @ApiProperty() version: number;
}
export class CatalogPageDto {
  @ApiProperty({ type: [CatalogEntryDto] }) data: CatalogEntryDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
