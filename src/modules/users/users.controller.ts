import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeMyPasswordDto, ResetUserPasswordDto } from './dto/password.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

type AuthRequest = { user: JwtPayload };

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Audited(AUDIT_ACTIONS.USER_CREATED, {
    resourceType: 'USER',
    resourceFromResponseId: true,
  })
  @RequirePermissions('users.create')
  @ApiOperation({ summary: 'Crear usuario del sistema (personal de salud o administrador)' })
  @ApiResponse({ status: 201, type: UserResponseDto, description: 'Usuario creado correctamente.' })
  @ApiConflictResponse({ description: 'El email ya está registrado en el sistema.' })
  @ApiForbiddenResponse({ description: 'El actor no puede asignar el rol inicial solicitado.' })
  create(
    @Body() dto: CreateUserDto,
    @Request() request: AuthRequest,
  ): Promise<UserResponseDto> {
    return this.usersService.create(dto, {
      id: request.user.sub,
      permissions: request.user.permissions,
    });
  }

  @Get()
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Listar todos los usuarios del sistema' })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  findAll(): Promise<UserResponseDto[]> {
    return this.usersService.findAll();
  }

  @Get('professionals')
  @ApiOperation({
    summary:
      'Buscar profesionales activos (nombre/profesión) — para selectores clínicos, sin datos sensibles',
  })
  searchProfessionals(@Query('q') q?: string) {
    return this.usersService.searchProfessionals(q ?? '');
  }

  @Patch('me/password')
  @Audited(AUDIT_ACTIONS.USER_PASSWORD_CHANGED, { resourceType: 'USER' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cambiar mi contraseña verificando la credencial actual' })
  @ApiResponse({ status: 204, description: 'Contraseña actualizada y sesiones revocadas.' })
  @ApiBadRequestResponse({ description: 'Credencial actual incorrecta o nueva contraseña repetida.' })
  async changeMyPassword(
    @Body() dto: ChangeMyPasswordDto,
    @Request() request: AuthRequest,
  ): Promise<void> {
    await this.usersService.changeMyPassword(request.user.sub, dto);
  }

  @Get(':id')
  @Audited(AUDIT_ACTIONS.USER_VIEWED, { resourceType: 'USER', resourceParam: 'id' })
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Obtener usuario por ID' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @Audited(AUDIT_ACTIONS.USER_UPDATED, { resourceType: 'USER', resourceParam: 'id' })
  @RequirePermissions('users.update')
  @ApiOperation({ summary: 'Actualizar identidad y perfil profesional del usuario' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  @ApiConflictResponse({ description: 'Email, usuario o documento ya utilizado.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Request() request: AuthRequest,
  ): Promise<UserResponseDto> {
    return this.usersService.update(id, dto, request.user.sub);
  }

  @Patch(':id/deactivate')
  @Audited(AUDIT_ACTIONS.USER_DEACTIVATED, { resourceType: 'USER', resourceParam: 'id' })
  @RequirePermissions('users.deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Desactivar usuario (borrado lógico — el registro se conserva para auditoría)',
  })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  @ApiForbiddenResponse({ description: 'No se permite desactivar la cuenta propia.' })
  @ApiConflictResponse({ description: 'Debe permanecer al menos un administrador activo.' })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() request: AuthRequest,
  ): Promise<UserResponseDto> {
    return this.usersService.deactivate(id, request.user.sub);
  }

  @Patch(':id/reactivate')
  @Audited(AUDIT_ACTIONS.USER_REACTIVATED, { resourceType: 'USER', resourceParam: 'id' })
  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reactivar una cuenta de usuario y mantener sus sesiones revocadas' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() request: AuthRequest,
  ): Promise<UserResponseDto> {
    return this.usersService.reactivate(id, request.user.sub);
  }

  @Patch(':id/role')
  @Audited(AUDIT_ACTIONS.USER_ROLE_ASSIGNED, { resourceType: 'USER', resourceParam: 'id' })
  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar o reemplazar el rol de un usuario' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario o rol no encontrado.' })
  @ApiForbiddenResponse({ description: 'Cuenta propia o rol con permisos superiores a los del actor.' })
  @ApiConflictResponse({ description: 'Debe permanecer al menos un administrador activo.' })
  assignRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRoleDto,
    @Request() request: AuthRequest,
  ): Promise<UserResponseDto> {
    return this.usersService.assignRole(id, dto, {
      id: request.user.sub,
      permissions: request.user.permissions,
    });
  }

  @Patch(':id/password')
  @Audited(AUDIT_ACTIONS.USER_PASSWORD_RESET, { resourceType: 'USER', resourceParam: 'id' })
  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Establecer una nueva contraseña y revocar todas las sesiones' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  @ApiBadRequestResponse({ description: 'La nueva contraseña coincide con la actual.' })
  @ApiForbiddenResponse({ description: 'La cuenta propia usa el endpoint de cambio verificado.' })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetUserPasswordDto,
    @Request() request: AuthRequest,
  ): Promise<UserResponseDto> {
    return this.usersService.resetPassword(id, dto, request.user.sub);
  }
}
