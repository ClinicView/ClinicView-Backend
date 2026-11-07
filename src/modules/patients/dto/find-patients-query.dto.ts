import { ApiProperty } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum PatientListStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ALL = 'all',
}

export class FindPatientsQueryDto {
  @ApiProperty({
    required: false,
    enum: PatientListStatus,
    default: PatientListStatus.ACTIVE,
    description: 'Estado de los pacientes incluidos en el listado',
  })
  @IsOptional()
  @IsEnum(PatientListStatus)
  status?: PatientListStatus = PatientListStatus.ACTIVE;

  @ApiProperty({
    required: false,
    description: 'Texto libre — busca en nombre y número de documento',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false, enum: DocumentType })
  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  documentNumber?: string;

  @ApiProperty({ required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ required: false, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
