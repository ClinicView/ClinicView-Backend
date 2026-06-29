import { ApiProperty } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';

export class UserRoleSummaryDto {
  @ApiProperty() key: string;
  @ApiProperty() name: string;
}

/**
 * UserResponseDto — forma pública del usuario.
 * NUNCA incluir passwordHash aquí ni en ninguna respuesta HTTP.
 */
export class UserResponseDto {
  @ApiProperty({ format: 'uuid', example: 'c7f3a1b2-...' })
  id: string;

  @ApiProperty({ example: 'maria.lopez@hospital.org' })
  email: string;

  @ApiProperty({ example: 'mlopez' })
  username: string;

  @ApiProperty({ example: 'María' })
  firstName: string;

  @ApiProperty({ example: 'López Sánchez' })
  lastName: string;

  @ApiProperty({ example: 'María López' })
  fullName: string;

  @ApiProperty({ enum: DocumentType, nullable: true, required: false })
  documentType: DocumentType | null;

  @ApiProperty({ example: '12345678', nullable: true, required: false, type: String })
  documentNumber: string | null;

  @ApiProperty({ example: 'Médico pediatra', nullable: true, required: false, type: String })
  profession: string | null;

  @ApiProperty({ description: 'false si el usuario fue desactivado (borrado lógico).' })
  isActive: boolean;

  @ApiProperty({ nullable: true, type: 'string', format: 'date-time', required: false })
  lastLoginAt: Date | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ type: [UserRoleSummaryDto] })
  roles: UserRoleSummaryDto[];
}
