import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { OCR_IDENTIFIER } from '../../../core/ia/ocr-layout';

export class OcrReviewLineDto {
  @ApiProperty()
  @IsString()
  @Matches(OCR_IDENTIFIER)
  lineId: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  page: number;

  @ApiProperty({ type: [Number], minItems: 4, maxItems: 4 })
  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsInt({ each: true })
  @Min(0, { each: true })
  bbox: number[];

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  order: number;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  text: string;

  @ApiProperty()
  @IsBoolean()
  reviewed: boolean;

  @ApiProperty({
    type: [String],
    description: 'Original machine line IDs. Empty only for a justified manual region.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @Matches(OCR_IDENTIFIER, { each: true })
  sourceLineIds: string[];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SaveOcrLayoutReviewDto {
  @ApiPropertyOptional({
    description: 'Explicit confirmation before replacing a previously corrected clinical text.',
  })
  @IsOptional()
  @IsBoolean()
  confirmTextReplacement?: boolean;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiProperty()
  @IsString()
  @Matches(OCR_IDENTIFIER)
  runId: string;

  @ApiProperty({ type: [OcrReviewLineDto] })
  @IsArray()
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => OcrReviewLineDto)
  lines: OcrReviewLineDto[];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
