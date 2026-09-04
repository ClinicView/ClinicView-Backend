import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { REVIEW_PRIORITIES, type ReviewPriorityValue } from './review-assignment.dto';

export const REVIEW_QUEUE_SCOPES = ['AVAILABLE', 'MINE', 'UNASSIGNED', 'ALL'] as const;
export type ReviewQueueScope = (typeof REVIEW_QUEUE_SCOPES)[number];

export class FindReviewQueueQueryDto {
  @ApiPropertyOptional({
    enum: REVIEW_QUEUE_SCOPES,
    default: 'AVAILABLE',
    description: 'AVAILABLE incluye documentos sin asignar y los asignados al usuario actual.',
  })
  @IsOptional()
  @IsIn(REVIEW_QUEUE_SCOPES)
  scope?: ReviewQueueScope;

  @ApiPropertyOptional({ enum: REVIEW_PRIORITIES })
  @IsOptional()
  @IsIn(REVIEW_PRIORITIES)
  priority?: ReviewPriorityValue;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
