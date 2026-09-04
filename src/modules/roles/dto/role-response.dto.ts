import { ApiProperty } from '@nestjs/swagger';
import { PermissionResponseDto } from './permission-response.dto';

export class RoleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  name: string;

  @ApiProperty({ required: false, nullable: true, type: String })
  description: string | null;

  @ApiProperty({ type: [PermissionResponseDto] })
  permissions: PermissionResponseDto[];

  @ApiProperty({ description: 'Los roles base no pueden eliminarse ni cambiar su clave.' })
  isSystem: boolean;

  @ApiProperty({ description: 'Cantidad de usuarios que tienen asignado el rol.' })
  userCount: number;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt: Date;
}
