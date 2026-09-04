import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REVIEW_PRIORITIES, type ReviewPriorityValue } from './review-assignment.dto';

export class ReviewPatientSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty() documentType: string;
  @ApiProperty() documentNumber: string;
}

export class ReviewAssigneeDto {
  @ApiProperty() id: string;
  @ApiProperty() username: string;
  @ApiProperty() fullName: string;
  @ApiPropertyOptional({ type: String, nullable: true }) profession: string | null;
}

export class ReviewQueueItemDto {
  @ApiProperty() id: string;
  @ApiProperty() originalName: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiPropertyOptional({ type: String, nullable: true }) processedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ enum: REVIEW_PRIORITIES }) reviewPriority: ReviewPriorityValue;
  @ApiProperty({ minimum: 0 }) version: number;
  @ApiProperty({ enum: ['UNASSIGNED', 'MINE', 'ASSIGNED'] })
  assignmentState: 'UNASSIGNED' | 'MINE' | 'ASSIGNED';
  @ApiPropertyOptional({ type: String, nullable: true }) assignedAt: Date | null;
  @ApiPropertyOptional({ type: () => ReviewAssigneeDto, nullable: true })
  assignee: ReviewAssigneeDto | null;
  @ApiProperty({ type: () => ReviewPatientSummaryDto }) patient: ReviewPatientSummaryDto;
}

export class ReviewAssignmentResponseDto {
  @ApiProperty() documentId: string;
  @ApiProperty({ enum: REVIEW_PRIORITIES }) reviewPriority: ReviewPriorityValue;
  @ApiProperty({ minimum: 0 }) version: number;
  @ApiPropertyOptional({ type: String, nullable: true }) assignedAt: Date | null;
  @ApiPropertyOptional({ type: () => ReviewAssigneeDto, nullable: true })
  assignee: ReviewAssigneeDto | null;
}

export class ReviewAssigneesResponseDto {
  @ApiProperty({ type: () => [ReviewAssigneeDto] }) data: ReviewAssigneeDto[];
}

export class ReviewQueuePageDto {
  @ApiProperty({ type: () => [ReviewQueueItemDto] }) data: ReviewQueueItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
