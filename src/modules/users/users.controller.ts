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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { PermissionsGuard } from '../../core/rbac/permissions.guard';
import { RequirePermissions } from '../../core/rbac/requires-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions('users.create')
  @ApiOperation({ summary: 'Crear usuario del sistema (personal de salud o administrador)' })
  @ApiResponse({ status: 201, type: UserResponseDto, description: 'Usuario creado correctamente.' })
  @ApiConflictResponse({ description: 'El email ya está registrado en el sistema.' })
  create(@Body() dto: CreateUserDto): Promise<UserResponseDto> {
    return this.usersService.create(dto);
  }

  @Get()
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Listar todos los usuarios del sistema' })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  findAll(): Promise<UserResponseDto[]> {
    return this.usersService.findAll();
  }

  @Get(':id')
  @RequirePermissions('users.read')
  @ApiOperation({ summary: 'Obtener usuario por ID' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('users.update')
  @ApiOperation({ summary: 'Actualizar perfil profesional o contraseña del usuario' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return this.usersService.update(id, dto);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('users.deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Desactivar usuario (borrado lógico — el registro se conserva para auditoría)',
  })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado.' })
  deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponseDto> {
    return this.usersService.deactivate(id);
  }

  @Patch(':id/role')
  @RequirePermissions('admin.users.manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Asignar o reemplazar el rol de un usuario' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiNotFoundResponse({ description: 'Usuario o rol no encontrado.' })
  assignRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRoleDto,
  ): Promise<UserResponseDto> {
    return this.usersService.assignRole(id, dto);
  }
}
