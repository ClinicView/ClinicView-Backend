import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({
    example: 'ENFERMERIA',
    description: 'Clave estable del rol en MAYUSCULAS_CON_GUIONES_BAJOS.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'La clave debe usar MAYUSCULAS, números y guion bajo.',
  })
  key: string;

  @ApiProperty({ example: 'Enfermería' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiProperty({ required: false, nullable: true, maxLength: 240 })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  description?: string;
}
