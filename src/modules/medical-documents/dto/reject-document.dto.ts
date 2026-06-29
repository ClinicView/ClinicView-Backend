import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RejectDocumentDto {
  @ApiProperty({ minLength: 10, maxLength: 500, description: 'Motivo del rechazo' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
