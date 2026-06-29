import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewPatientSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() firstName: string;
  @ApiProperty() lastName: string;
  @ApiProperty() documentType: string;
  @ApiProperty() documentNumber: string;
}

export class ReviewQueueItemDto {
  @ApiProperty() id: string;
  @ApiProperty() originalName: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiPropertyOptional({ type: String, nullable: true }) processedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: () => ReviewPatientSummaryDto }) patient: ReviewPatientSummaryDto;
}

export class ReviewQueuePageDto {
  @ApiProperty({ type: () => [ReviewQueueItemDto] }) data: ReviewQueueItemDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
