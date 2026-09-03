import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class DeleteRecordMediaQueryDto {
  @ApiProperty({ minimum: 0, description: 'Versión vigente del asset temporal.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion: number;
}
