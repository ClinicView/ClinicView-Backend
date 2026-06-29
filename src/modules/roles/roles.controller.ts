import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RoleResponseDto } from './dto/role-response.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermissions('roles.read')
  @ApiOperation({ summary: 'Listar todos los roles con sus permisos' })
  @ApiResponse({ status: 200, type: [RoleResponseDto] })
  findAll(): Promise<RoleResponseDto[]> {
    return this.rolesService.findAll();
  }

  @Get(':id')
  @RequirePermissions('roles.read')
  @ApiOperation({ summary: 'Obtener un rol por ID con sus permisos' })
  @ApiResponse({ status: 200, type: RoleResponseDto })
  @ApiNotFoundResponse({ description: 'Rol no encontrado.' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<RoleResponseDto> {
    return this.rolesService.findOne(id);
  }
}
