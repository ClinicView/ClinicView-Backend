import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class AssignRoleDto {
  @ApiProperty({ description: 'Clave del rol a asignar (ej. MEDICO, ADMINISTRADOR).', example: 'MEDICO' })
  @IsString()
  @IsNotEmpty()
  roleKey: string;
}
