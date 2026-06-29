import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecordOrigin, RecordStatus, RecordType } from '@prisma/client';

export class RecordResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() patientId: string;
  @ApiProperty({ enum: RecordType }) recordType: RecordType;
  @ApiProperty({ enum: RecordOrigin }) origin: RecordOrigin;
  @ApiProperty({ enum: RecordStatus }) status: RecordStatus;
  @ApiProperty() attendedAt: Date;
  @ApiProperty() summary: string;
  @ApiPropertyOptional({ type: String, nullable: true }) notes: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) parentRecordId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) voidReason: string | null;
  @ApiProperty() correctionsCount: number;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional({ type: String, nullable: true }) createdBy: string | null;
  @ApiProperty() updatedAt: Date;
}
