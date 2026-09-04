import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsDateString, IsString, MaxLength } from 'class-validator';

export class UpdateRolePermissionsDto {
  @ApiProperty({
    type: [String],
    example: ['patients.read', 'records.read'],
    description: 'Conjunto completo de permisos que conservará el rol.',
  })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  permissionKeys: string[];

  @ApiProperty({
    format: 'date-time',
    description: 'Marca de versión para control de concurrencia optimista.',
  })
  @IsDateString()
  expectedUpdatedAt: string;
}
