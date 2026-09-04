import { ApiProperty, PartialType, PickType } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';
import { CreateRoleDto } from './create-role.dto';

export class UpdateRoleDto extends PartialType(
  PickType(CreateRoleDto, ['name', 'description'] as const),
) {
  @ApiProperty({
    format: 'date-time',
    description: 'Marca de versión recibida al cargar el rol; evita sobrescribir cambios ajenos.',
  })
  @IsDateString()
  expectedUpdatedAt: string;
}
