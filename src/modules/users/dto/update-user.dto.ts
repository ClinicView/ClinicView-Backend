import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateUserDto } from './create-user.dto';

/**
 * Campos editables del perfil profesional.
 * La contraseña se gestiona exclusivamente mediante endpoints dedicados que
 * verifican la credencial actual o requieren el permiso administrativo fuerte.
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'roleKey', 'documentType'] as const),
) {
  @ApiPropertyOptional({
    enum: DocumentType,
    nullable: true,
    description: 'Tipo de documento; null elimina el valor previamente registrado.',
  })
  @IsOptional()
  @IsEnum(DocumentType, { message: 'Tipo de documento inválido.' })
  documentType?: DocumentType | null;
}
