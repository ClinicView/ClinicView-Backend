import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class VoidRecordDto {
  @ApiProperty({ minLength: 10, maxLength: 500, description: 'Motivo de anulación' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
