import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class AssignReviewDocumentDto {
  @ApiProperty({ description: 'Usuario activo y habilitado para validar documentos.' })
  @IsUUID()
  assigneeId: string;

  @ApiProperty({ minimum: 0, description: 'Version observada para control de concurrencia.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion: number;
}

export class ReleaseReviewDocumentDto {
  @ApiProperty({ minimum: 0, description: 'Version observada para control de concurrencia.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion: number;
}

export const REVIEW_PRIORITIES = ['URGENT', 'HIGH', 'NORMAL', 'LOW'] as const;
export type ReviewPriorityValue = (typeof REVIEW_PRIORITIES)[number];

export class UpdateReviewPriorityDto {
  @ApiProperty({ enum: REVIEW_PRIORITIES })
  @IsIn(REVIEW_PRIORITIES)
  priority: ReviewPriorityValue;

  @ApiProperty({ minimum: 0, description: 'Version observada para control de concurrencia.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion: number;
}

export class FindReviewAssigneesQueryDto {
  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  q?: string;
}
