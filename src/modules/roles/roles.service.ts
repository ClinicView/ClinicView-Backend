import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CreateRoleDto } from './dto/create-role.dto';
import { PermissionResponseDto } from './dto/permission-response.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleWithPermissions, RolesRepository } from './repositories/roles.repository';

export const SYSTEM_ROLE_KEYS = new Set([
  'ADMINISTRADOR',
  'MEDICO',
  'FARMACEUTICO',
  'LABORATORISTA',
  'TERAPEUTA',
]);

const ADMINISTRATOR_REQUIRED_PERMISSIONS = [
  'users.read',
  'users.create',
  'users.update',
  'users.deactivate',
  'roles.read',
  'roles.manage',
  'admin.users.manage',
  'admin.roles.manage',
  'admin.audit.read',
] as const;

@Injectable()
export class RolesService {
  constructor(private readonly rolesRepository: RolesRepository) {}

  async findAll(): Promise<RoleResponseDto[]> {
    const roles = await this.rolesRepository.findMany();
    return roles.map((r) => this.toResponse(r));
  }

  async findOne(id: string): Promise<RoleResponseDto> {
    const role = await this.rolesRepository.findById(id);
    if (!role) throw new NotFoundException('Rol no encontrado.');
    return this.toResponse(role);
  }

  async findPermissions(): Promise<PermissionResponseDto[]> {
    const permissions = await this.rolesRepository.findPermissions();
    return permissions.map((permission) => ({
      id: permission.id,
      key: permission.key,
      description: permission.description ?? null,
    }));
  }

  async create(dto: CreateRoleDto): Promise<RoleResponseDto> {
    const key = dto.key.trim().toUpperCase();
    if (await this.rolesRepository.findByKey(key)) {
      throw new ConflictException(`Ya existe un rol con la clave '${key}'.`);
    }
    try {
      const role = await this.rolesRepository.create({
        key,
        name: dto.name.trim(),
        description: this.emptyToNull(dto.description),
      });
      return this.toResponse(role);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`Ya existe un rol con la clave '${key}'.`);
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateRoleDto): Promise<RoleResponseDto> {
    const role = await this.rolesRepository.findById(id);
    if (!role) throw new NotFoundException('Rol no encontrado.');
    if (dto.name === undefined && dto.description === undefined) {
      throw new BadRequestException('Indica al menos un campo para actualizar.');
    }
    try {
      const result = await this.rolesRepository.update(
        id,
        {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined
            ? { description: this.emptyToNull(dto.description) }
            : {}),
        },
        new Date(dto.expectedUpdatedAt),
      );
      if (result.status === 'not-found') throw new NotFoundException('Rol no encontrado.');
      if (result.status === 'stale') throw this.staleRoleException();
      return this.toResponse(result.role);
    } catch (error) {
      this.rethrowTransactionConflict(error);
      throw error;
    }
  }

  async replacePermissions(
    id: string,
    dto: UpdateRolePermissionsDto,
    actorPermissions: string[],
    actorId: string,
  ): Promise<RoleResponseDto> {
    const role = await this.rolesRepository.findById(id);
    if (!role) throw new NotFoundException('Rol no encontrado.');

    const actorPermissionSet = new Set(actorPermissions);
    const actorCannotManageCurrentRole = role.rolePermissions.some(
      ({ permission }) => !actorPermissionSet.has(permission.key),
    );
    const actorCannotGrant = dto.permissionKeys.some((key) => !actorPermissionSet.has(key));
    if (actorCannotManageCurrentRole || actorCannotGrant) {
      throw new ForbiddenException(
        'No puedes administrar un rol con permisos superiores a los tuyos.',
      );
    }

    if (role.key === 'ADMINISTRADOR') {
      const requested = new Set(dto.permissionKeys);
      const missingRequired = ADMINISTRATOR_REQUIRED_PERMISSIONS.filter(
        (permission) => !requested.has(permission),
      );
      if (missingRequired.length > 0) {
        throw new ConflictException(
          'El rol Administrador debe conservar los permisos críticos de administración.',
        );
      }
    }

    let result;
    try {
      result = await this.rolesRepository.replacePermissions(
        id,
        [...new Set(dto.permissionKeys)],
        new Date(dto.expectedUpdatedAt),
        actorId,
      );
    } catch (error) {
      this.rethrowTransactionConflict(error);
      throw error;
    }
    if (result.status === 'not-found') throw new NotFoundException('Rol no encontrado.');
    if (result.status === 'stale') throw this.staleRoleException();
    if (result.status === 'invalid-permissions') {
      throw new BadRequestException(
        `Permisos no reconocidos: ${result.keys.join(', ')}.`,
      );
    }
    return this.toResponse(result.role);
  }

  async delete(id: string, expectedUpdatedAt: string): Promise<void> {
    const role = await this.rolesRepository.findById(id);
    if (!role) throw new NotFoundException('Rol no encontrado.');
    if (SYSTEM_ROLE_KEYS.has(role.key)) {
      throw new ConflictException('Los roles base del sistema no se pueden eliminar.');
    }
    let result;
    try {
      result = await this.rolesRepository.delete(id, new Date(expectedUpdatedAt));
    } catch (error) {
      this.rethrowTransactionConflict(error);
      throw error;
    }
    if (result.status === 'not-found') throw new NotFoundException('Rol no encontrado.');
    if (result.status === 'stale') throw this.staleRoleException();
    if (result.status === 'in-use') {
      throw new ConflictException(
        `El rol está asignado a ${result.userCount} usuario(s). Reasígnalos antes de eliminarlo.`,
      );
    }
  }

  private toResponse(role: RoleWithPermissions): RoleResponseDto {
    const permissions: PermissionResponseDto[] = role.rolePermissions.map((rp) => ({
      id: rp.permission.id,
      key: rp.permission.key,
      description: rp.permission.description ?? null,
    }));

    return {
      id: role.id,
      key: role.key,
      name: role.name,
      description: role.description ?? null,
      permissions,
      isSystem: SYSTEM_ROLE_KEYS.has(role.key),
      userCount: role._count.userRoles,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  private emptyToNull(value?: string): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private staleRoleException(): ConflictException {
    return new ConflictException(
      'El rol cambió desde que lo abriste. Recarga la información antes de guardar.',
    );
  }

  private rethrowTransactionConflict(error: unknown): void {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      throw new ConflictException(
        'Otra operación modificó el rol al mismo tiempo. Intenta nuevamente.',
      );
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      throw new ConflictException(
        'El rol recibió una asignación concurrente. Recarga la información e intenta nuevamente.',
      );
    }
  }
}
