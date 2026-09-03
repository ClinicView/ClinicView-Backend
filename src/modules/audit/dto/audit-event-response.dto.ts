import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuditOutcome } from '@prisma/client';

export class AuditEventResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) id: string;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt: Date;
  @ApiProperty() action: string;
  @ApiProperty({ enum: AuditOutcome }) outcome: AuditOutcome;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) actorId: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) patientId: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) resourceType: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) resourceId: string | null;
  @ApiProperty({ type: String, format: 'uuid' }) requestId: string;
  @ApiProperty() method: string;
  @ApiProperty() route: string;
  @ApiProperty() statusCode: number;
  @ApiProperty() durationMs: number;
  @ApiPropertyOptional({ type: String, nullable: true }) ipHash: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) userAgentHash: string | null;
}

export class AuditEventsPageDto {
  @ApiProperty({ type: [AuditEventResponseDto] }) data: AuditEventResponseDto[];
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) nextCursor: string | null;
}
