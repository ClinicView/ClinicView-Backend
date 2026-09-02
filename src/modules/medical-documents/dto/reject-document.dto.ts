import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class RejectDocumentDto {
  @ApiProperty({
    description: 'Versión leída por el cliente. Evita rechazar una revisión que ya cambió.',
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  expectedVersion: number;

  @ApiProperty({ minLength: 10, maxLength: 500, description: 'Motivo del rechazo' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;
}
