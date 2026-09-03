import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@hospital.org' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Mantiene la cookie de sesión después de cerrar el navegador.',
  })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
