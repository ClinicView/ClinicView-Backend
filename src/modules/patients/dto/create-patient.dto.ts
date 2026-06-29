import { ApiProperty } from '@nestjs/swagger';
import { DocumentType, Sex } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreatePatientDto {
  @ApiProperty({ enum: DocumentType, example: DocumentType.DNI })
  @IsEnum(DocumentType)
  documentType: DocumentType;

  @ApiProperty({ example: '12345678' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  documentNumber: string;

  @ApiProperty({ example: 'María' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'García López' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: '1985-06-15', description: 'Fecha en formato YYYY-MM-DD' })
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({ enum: Sex, example: Sex.F })
  @IsEnum(Sex)
  sex: Sex;

  @ApiProperty({ required: false, example: '+51 987 654 321' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty({ required: false, example: 'paciente@correo.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false, example: 'Av. Principal 123, Lima' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;
}
