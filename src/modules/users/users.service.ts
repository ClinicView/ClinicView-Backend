import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { HashingService } from '../../core/security/hashing.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { type UserWithRoles, UsersRepository } from './repositories/users.repository';

export interface UserWithPermissionKeys {
  user: User;
  permissionKeys: string[];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly hashingService: HashingService,
  ) {}

  async create(dto: CreateUserDto): Promise<UserResponseDto> {
    await this.ensureUniqueIdentity(dto.email, dto.username, dto.documentNumber);

    const role = dto.roleKey ? await this.usersRepository.findRoleByKey(dto.roleKey) : null;
    if (dto.roleKey && !role) throw new NotFoundException(`Rol '${dto.roleKey}' no encontrado.`);

    const passwordHash = await this.hashingService.hash(dto.password);
    const fullName = this.buildFullName(dto.firstName, dto.lastName);

    let user = await this.usersRepository.create({
      email: dto.email,
      username: dto.username,
      firstName: dto.firstName,
      lastName: dto.lastName,
      fullName,
      documentType: dto.documentType,
      documentNumber: this.emptyToNull(dto.documentNumber),
      profession: this.emptyToNull(dto.profession),
      passwordHash,
    });

    if (role) {
      user = await this.usersRepository.assignRole(user.id, role.id);
    }

    return this.toResponse(user);
  }

  async findAll(): Promise<UserResponseDto[]> {
    const users = await this.usersRepository.findMany();
    return users.map((u) => this.toResponse(u));
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.usersRepository.findById(id);
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    return this.toResponse(user);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const existing = await this.usersRepository.findById(id);
    if (!existing) throw new NotFoundException('Usuario no encontrado.');

    if (dto.username !== undefined) {
      const sameUsername = await this.usersRepository.findByUsername(dto.username);
      if (sameUsername && sameUsername.id !== id) {
        throw new ConflictException('El nombre de usuario ya está registrado en el sistema.');
      }
    }

    if (dto.documentNumber !== undefined && dto.documentNumber !== '') {
      const sameDocument = await this.usersRepository.findByDocumentNumber(dto.documentNumber);
      if (sameDocument && sameDocument.id !== id) {
        throw new ConflictException('El documento ya está registrado en el sistema.');
      }
    }

    const firstName = dto.firstName ?? existing.firstName;
    const lastName = dto.lastName ?? existing.lastName;
    const data: Partial<{
      username: string;
      firstName: string;
      lastName: string;
      fullName: string;
      documentType: typeof dto.documentType;
      documentNumber: string | null;
      profession: string | null;
      passwordHash: string;
    }> = {};

    if (dto.username !== undefined) data.username = dto.username;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      data.fullName = this.buildFullName(firstName, lastName);
    }
    if (dto.documentType !== undefined) data.documentType = dto.documentType;
    if (dto.documentNumber !== undefined) data.documentNumber = this.emptyToNull(dto.documentNumber);
    if (dto.profession !== undefined) data.profession = this.emptyToNull(dto.profession);
    if (dto.password !== undefined) {
      data.passwordHash = await this.hashingService.hash(dto.password);
    }

    const user = await this.usersRepository.update(id, data);
    return this.toResponse(user);
  }

  async deactivate(id: string): Promise<UserResponseDto> {
    const existing = await this.usersRepository.findById(id);
    if (!existing) throw new NotFoundException('Usuario no encontrado.');

    const user = await this.usersRepository.deactivate(id);
    return this.toResponse(user);
  }

  async assignRole(id: string, dto: AssignRoleDto): Promise<UserResponseDto> {
    const existing = await this.usersRepository.findById(id);
    if (!existing) throw new NotFoundException('Usuario no encontrado.');

    const role = await this.usersRepository.findRoleByKey(dto.roleKey);
    if (!role) throw new NotFoundException(`Rol '${dto.roleKey}' no encontrado.`);

    const user = await this.usersRepository.assignRole(id, role.id);
    return this.toResponse(user);
  }

  /**
   * Para uso exclusivo del módulo auth — devuelve el usuario con el hash.
   * No exponer por HTTP.
   */
  async findByEmailWithCredentials(email: string): Promise<User | null> {
    return this.usersRepository.findByEmail(email);
  }

  /** Para uso exclusivo del módulo auth — incluye permisos para el JWT. */
  async findByEmailWithPermissions(email: string): Promise<UserWithPermissionKeys | null> {
    const result = await this.usersRepository.findByEmailWithPermissions(email);
    if (!result) return null;
    const permissionKeys = result.userRoles
      .flatMap((ur) => ur.role.rolePermissions)
      .map((rp) => rp.permission.key);
    return { user: result, permissionKeys };
  }

  /** Para uso exclusivo del módulo auth — registra el último acceso. */
  async updateLastLogin(id: string): Promise<void> {
    await this.usersRepository.updateLastLogin(id);
  }

  private toResponse(user: UserWithRoles): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      documentType: user.documentType,
      documentNumber: user.documentNumber,
      profession: user.profession,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roles: user.userRoles.map((ur) => ({ key: ur.role.key, name: ur.role.name })),
    };
  }

  private async ensureUniqueIdentity(
    email: string,
    username: string,
    documentNumber?: string,
  ): Promise<void> {
    const existingEmail = await this.usersRepository.findByEmail(email);
    if (existingEmail) throw new ConflictException('El email ya está registrado en el sistema.');

    const existingUsername = await this.usersRepository.findByUsername(username);
    if (existingUsername) {
      throw new ConflictException('El nombre de usuario ya está registrado en el sistema.');
    }

    if (documentNumber) {
      const existingDocument = await this.usersRepository.findByDocumentNumber(documentNumber);
      if (existingDocument) throw new ConflictException('El documento ya está registrado en el sistema.');
    }
  }

  private buildFullName(firstName: string, lastName: string): string {
    return `${firstName.trim()} ${lastName.trim()}`.trim();
  }

  private emptyToNull(value?: string): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }
}
