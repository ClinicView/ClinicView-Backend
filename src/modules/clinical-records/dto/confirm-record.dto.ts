import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class ConfirmRecordDto {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) expectedVersion: number;
  @ApiProperty({
    enum: [true],
    description: 'Revisión explícita de esta versión; no es firma digital certificada.',
  })
  @Equals(true)
  attested: boolean;
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  note?: string;
}

export class RecordConfirmationDto {
  @ApiProperty() recordVersion: number;
  @ApiProperty() actorId: string;
  @ApiProperty() actorName: string;
  @ApiProperty() actorUsername: string;
  @ApiProperty({ enum: ['ORIGINAL_PROFESSIONAL', 'REVIEWER'] }) capacity: string;
  @ApiPropertyOptional({ type: String, nullable: true }) note: string | null;
  @ApiProperty() contentHash: string;
  @ApiProperty() confirmedAt: Date;
}
