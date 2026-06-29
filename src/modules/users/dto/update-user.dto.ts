import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/**
 * Campos editables del perfil profesional y password (opcional).
 * El email no es editable; sigue siendo el identificador de login.
 * Un cambio de contraseña a través de este endpoint requiere privilegio users.update.
 * El flujo de cambio de contraseña con verificación estará en auth (siguiente fase).
 */
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['email', 'roleKey'] as const),
) {}
