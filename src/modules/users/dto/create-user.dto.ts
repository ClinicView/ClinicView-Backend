import { ApiProperty } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'María', description: 'Nombres del profesional.' })
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(80, { message: 'El nombre no puede superar 80 caracteres.' })
  firstName: string;

  @ApiProperty({ example: 'López Sánchez', description: 'Apellidos del profesional.' })
  @IsString()
  @MinLength(2, { message: 'El apellido debe tener al menos 2 caracteres.' })
  @MaxLength(100, { message: 'El apellido no puede superar 100 caracteres.' })
  lastName: string;

  @ApiProperty({
    example: 'maria.lopez@hospital.org',
    description: 'Email institucional único del usuario.',
  })
  @IsEmail({}, { message: 'Debe ser un email válido.' })
  email: string;

  @ApiProperty({
    example: 'mlopez',
    description: 'Nombre de usuario único para identificación interna.',
  })
  @IsString()
  @MinLength(3, { message: 'El usuario debe tener al menos 3 caracteres.' })
  @MaxLength(50, { message: 'El usuario no puede superar 50 caracteres.' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'El usuario solo puede contener letras, números, punto, guion y guion bajo.',
  })
  username: string;

  @ApiProperty({
    enum: DocumentType,
    required: false,
    example: DocumentType.DNI,
    description: 'Tipo de documento de identidad del profesional.',
  })
  @IsOptional()
  @IsEnum(DocumentType, { message: 'Tipo de documento inválido.' })
  documentType?: DocumentType;

  @ApiProperty({
    required: false,
    example: '12345678',
    description: 'Número de documento de identidad del profesional.',
  })
  @IsOptional()
  @IsString()
  @MinLength(4, { message: 'El documento debe tener al menos 4 caracteres.' })
  @MaxLength(20, { message: 'El documento no puede superar 20 caracteres.' })
  documentNumber?: string;

  @ApiProperty({
    required: false,
    example: 'Médico pediatra',
    description: 'Profesión o cargo profesional visible en la ficha de usuario.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120, { message: 'La profesión no puede superar 120 caracteres.' })
  profession?: string;

  @ApiProperty({
    required: false,
    example: 'MEDICO',
    description: 'Clave del rol inicial. Si se omite, el usuario se crea sin rol asignado.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  roleKey?: string;

  @ApiProperty({
    description: 'Contraseña (mínimo 8 caracteres). No se devuelve en ninguna respuesta.',
    minLength: 8,
    writeOnly: true,
  })
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(100, { message: 'La contraseña no puede superar 100 caracteres.' })
  password: string;
}
