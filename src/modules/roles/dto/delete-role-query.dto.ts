import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class DeleteRoleQueryDto {
  @ApiProperty({ format: 'date-time', description: 'Versión conocida del rol.' })
  @IsDateString()
  expectedUpdatedAt: string;
}
