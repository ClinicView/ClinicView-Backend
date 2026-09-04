import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const SECURE_PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export class ResetUserPasswordDto {
  @ApiProperty({
    description:
      'Nueva contraseña administrativa. Debe tener al menos 12 caracteres, una letra y un número.',
    minLength: 12,
    maxLength: 100,
    writeOnly: true,
  })
  @IsString()
  @MinLength(12, { message: 'La contraseña debe tener al menos 12 caracteres.' })
  @MaxLength(100, { message: 'La contraseña no puede superar 100 caracteres.' })
  @Matches(SECURE_PASSWORD_PATTERN, {
    message: 'La contraseña debe incluir al menos una letra y un número.',
  })
  newPassword: string;
}

export class ChangeMyPasswordDto extends ResetUserPasswordDto {
  @ApiProperty({ description: 'Contraseña actual.', writeOnly: true })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  currentPassword: string;
}
