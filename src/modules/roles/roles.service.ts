import { Injectable, NotFoundException } from '@nestjs/common';
import { PermissionResponseDto } from './dto/permission-response.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { RoleWithPermissions, RolesRepository } from './repositories/roles.repository';

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
      createdAt: role.createdAt,
    };
  }
}
