import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class VoidRecordDto {
  @ApiProperty({ minimum: 0, description: 'Versión vigente del registro que se anula.' })
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiProperty({ minLength: 10, maxLength: 500, description: 'Motivo de anulación' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
