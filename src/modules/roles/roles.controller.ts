import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { AUDIT_ACTIONS } from '../audit/audit-action';
import { Audited } from '../audit/audit.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateRoleDto } from './dto/create-role.dto';
import { DeleteRoleQueryDto } from './dto/delete-role-query.dto';
import { PermissionResponseDto } from './dto/permission-response.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

type AuthRequest = { user: JwtPayload };

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

  @Get('permissions')
  @RequirePermissions('roles.read')
  @ApiOperation({ summary: 'Listar el catálogo de permisos disponibles' })
  @ApiResponse({ status: 200, type: [PermissionResponseDto] })
  findPermissions(): Promise<PermissionResponseDto[]> {
    return this.rolesService.findPermissions();
  }

  @Post()
  @Audited(AUDIT_ACTIONS.ROLE_CREATED, {
    resourceType: 'ROLE',
    resourceFromResponseId: true,
  })
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'Crear un rol personalizado sin permisos iniciales' })
  @ApiResponse({ status: 201, type: RoleResponseDto })
  @ApiConflictResponse({ description: 'La clave del rol ya existe.' })
  create(@Body() dto: CreateRoleDto): Promise<RoleResponseDto> {
    return this.rolesService.create(dto);
  }

  @Get(':id')
  @RequirePermissions('roles.read')
  @ApiOperation({ summary: 'Obtener un rol por ID con sus permisos' })
  @ApiResponse({ status: 200, type: RoleResponseDto })
  @ApiNotFoundResponse({ description: 'Rol no encontrado.' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<RoleResponseDto> {
    return this.rolesService.findOne(id);
  }

  @Patch(':id')
  @Audited(AUDIT_ACTIONS.ROLE_UPDATED, { resourceType: 'ROLE', resourceParam: 'id' })
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'Editar nombre o descripción de un rol' })
  @ApiResponse({ status: 200, type: RoleResponseDto })
  @ApiNotFoundResponse({ description: 'Rol no encontrado.' })
  @ApiConflictResponse({ description: 'La versión conocida del rol está obsoleta.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleResponseDto> {
    return this.rolesService.update(id, dto);
  }

  @Put(':id/permissions')
  @Audited(AUDIT_ACTIONS.ROLE_PERMISSIONS_UPDATED, {
    resourceType: 'ROLE',
    resourceParam: 'id',
  })
  @RequirePermissions('admin.roles.manage')
  @ApiOperation({ summary: 'Reemplazar de forma atómica la matriz de permisos de un rol' })
  @ApiResponse({ status: 200, type: RoleResponseDto })
  @ApiForbiddenResponse({ description: 'Intento de gestionar permisos superiores a los propios.' })
  @ApiConflictResponse({ description: 'El rol Administrador perdería permisos críticos.' })
  @ApiBadRequestResponse({ description: 'La solicitud contiene permisos no reconocidos.' })
  replacePermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRolePermissionsDto,
    @Request() request: AuthRequest,
  ): Promise<RoleResponseDto> {
    return this.rolesService.replacePermissions(
      id,
      dto,
      request.user.permissions,
      request.user.sub,
    );
  }

  @Delete(':id')
  @Audited(AUDIT_ACTIONS.ROLE_DELETED, { resourceType: 'ROLE', resourceParam: 'id' })
  @RequirePermissions('roles.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un rol personalizado que no esté asignado' })
  @ApiResponse({ status: 204, description: 'Rol eliminado.' })
  @ApiConflictResponse({ description: 'Rol base protegido o asignado a usuarios.' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteRoleQueryDto,
  ): Promise<void> {
    await this.rolesService.delete(id, query.expectedUpdatedAt);
  }
}
