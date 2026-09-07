import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { IsPastOrPresentClinicalDate } from '../../common/validation/clinical-date';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export class CreateEpisodeDto {
  @ApiProperty({ maxLength: 180 })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(180)
  title: string;
  @ApiPropertyOptional({ maxLength: 2000 })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiProperty({ format: 'date' }) @IsPastOrPresentClinicalDate() startedOn: string;
  @ApiProperty({ maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason: string;
}
export class UpdateEpisodeDto extends CreateEpisodeDto {
  @ApiProperty() @IsInt() @Min(0) expectedVersion: number;
}
export class EpisodeTransitionDto {
  @ApiProperty() @IsInt() @Min(0) expectedVersion: number;
  @ApiProperty({ enum: ['CLOSE', 'REOPEN'] }) @IsIn(['CLOSE', 'REOPEN']) action: 'CLOSE' | 'REOPEN';
  @ApiPropertyOptional({ format: 'date' })
  @ValidateIf(
    (value: EpisodeTransitionDto) => value.action === 'CLOSE' || value.endedOn !== undefined,
  )
  @IsPastOrPresentClinicalDate()
  endedOn?: string;
  @ApiProperty({ maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason: string;
  @ApiProperty({ enum: [true] }) @Equals(true) attested: boolean;
}
export class AssignEpisodeDto {
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  episodeId: string | null;
  @ApiProperty() @IsInt() @Min(0) expectedRecordVersion: number;
  @ApiProperty({ maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason: string;
}
export class EpisodePageQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'] })
  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  status?: 'OPEN' | 'CLOSED';
}
export class EpisodeDto {
  @ApiProperty() id: string;
  @ApiProperty() patientId: string;
  @ApiProperty() title: string;
  @ApiPropertyOptional({ nullable: true, type: String }) description: string | null;
  @ApiProperty({ format: 'date' }) startedOn: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date' }) endedOn: string | null;
  @ApiProperty({ enum: ['OPEN', 'CLOSED'] }) status: string;
  @ApiProperty() version: number;
}
export class EpisodeOverviewDto extends EpisodeDto {
  @ApiProperty() recordsCount: number;
  @ApiProperty() activeCount: number;
  @ApiProperty() pendingConfirmationCount: number;
}
export class EpisodesPageDto {
  @ApiProperty({ type: [EpisodeOverviewDto] }) data: EpisodeOverviewDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
export class EpisodeEventDto {
  @ApiProperty() id: string;
  @ApiProperty() action: string;
  @ApiProperty() actorName: string;
  @ApiProperty() reason: string;
  @ApiPropertyOptional({ type: String, nullable: true }) recordId: string | null;
  @ApiProperty({ type: Object }) payload: object;
  @ApiProperty() createdAt: Date;
}
export class EpisodeEventsPageDto {
  @ApiProperty({ type: [EpisodeEventDto] }) data: EpisodeEventDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
