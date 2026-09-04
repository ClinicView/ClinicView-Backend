import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { HashingService } from '../../core/security/hashing.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeMyPasswordDto, ResetUserPasswordDto } from './dto/password.dto';
import { UserResponseDto } from './dto/user-response.dto';
import {
  type RoleWithPermissionKeys,
  type UserWithRoles,
  UsersRepository,
} from './repositories/users.repository';

export interface UserWithPermissionKeys {
  user: User;
  permissionKeys: string[];
}

export interface UserMutationActor {
  id: string;
  permissions: string[];
}

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly hashingService: HashingService,
  ) {}

  async searchProfessionals(
    query: string,
  ): Promise<Array<{ id: string; fullName: string; profession: string | null }>> {
    return this.usersRepository.searchActiveProfessionals(query.trim());
  }

  async create(dto: CreateUserDto, actor: UserMutationActor): Promise<UserResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim().toLowerCase();
    const documentNumber = this.emptyToNull(dto.documentNumber);
    await this.ensureUniqueIdentity(email, username, documentNumber ?? undefined);

    const role = dto.roleKey
      ? await this.usersRepository.findRoleByKeyWithPermissions(dto.roleKey)
      : null;
    if (dto.roleKey && !role) throw new NotFoundException(`Rol '${dto.roleKey}' no encontrado.`);
    if (role) this.assertCanAssignRole(actor.permissions, role);

    const passwordHash = await this.hashingService.hash(dto.password);
    const fullName = this.buildFullName(dto.firstName, dto.lastName);
    const userData: Prisma.UserCreateInput = {
      email,
      username,
      firstName: dto.firstName.trim(),
      lastName: dto.lastName.trim(),
      fullName,
      documentType: dto.documentType,
      documentNumber,
      profession: this.emptyToNull(dto.profession),
      passwordHash,
      createdBy: actor.id,
      updatedBy: actor.id,
    };

    try {
      let user: UserWithRoles;
      if (role) {
        const result = await this.usersRepository.createWithRoleGuard(
          userData,
          role.id,
          role.updatedAt,
        );
        if (result.status === 'role-not-found') {
          throw new NotFoundException(`Rol '${dto.roleKey}' no encontrado.`);
        }
        if (result.status === 'stale-role') {
          throw new ConflictException(
            'El rol cambió durante la creación. Revisa sus permisos e intenta nuevamente.',
          );
        }
        user = result.user;
      } else {
        user = await this.usersRepository.create(userData);
      }
      return this.toResponse(user);
    } catch (error) {
      this.rethrowPersistenceConflict(error);
      throw error;
    }
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

  async update(id: string, dto: UpdateUserDto, actorId: string): Promise<UserResponseDto> {
    const existing = await this.usersRepository.findById(id);
    if (!existing) throw new NotFoundException('Usuario no encontrado.');

    if (dto.email !== undefined) {
      const normalizedEmail = dto.email.trim().toLowerCase();
      const sameEmail = await this.usersRepository.findByEmail(normalizedEmail);
      if (sameEmail && sameEmail.id !== id) {
        throw new ConflictException('El email ya está registrado en el sistema.');
      }
    }

    if (dto.username !== undefined) {
      const sameUsername = await this.usersRepository.findByUsername(
        dto.username.trim().toLowerCase(),
      );
      if (sameUsername && sameUsername.id !== id) {
        throw new ConflictException('El nombre de usuario ya está registrado en el sistema.');
      }
    }

    if (dto.documentNumber !== undefined && dto.documentNumber !== '') {
      const sameDocument = await this.usersRepository.findByDocumentNumber(
        dto.documentNumber.trim(),
      );
      if (sameDocument && sameDocument.id !== id) {
        throw new ConflictException('El documento ya está registrado en el sistema.');
      }
    }

    const firstName = dto.firstName ?? existing.firstName;
    const lastName = dto.lastName ?? existing.lastName;
    const data: Partial<{
      email: string;
      username: string;
      firstName: string;
      lastName: string;
      fullName: string;
      documentType: typeof dto.documentType;
      documentNumber: string | null;
      profession: string | null;
      updatedBy: string;
    }> = {};

    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.username !== undefined) data.username = dto.username.trim().toLowerCase();
    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.firstName !== undefined || dto.lastName !== undefined) {
      data.fullName = this.buildFullName(firstName, lastName);
    }
    if (dto.documentType !== undefined) data.documentType = dto.documentType;
    if (dto.documentNumber !== undefined) data.documentNumber = this.emptyToNull(dto.documentNumber);
    if (dto.profession !== undefined) data.profession = this.emptyToNull(dto.profession);
    data.updatedBy = actorId;

    try {
      const user = dto.email !== undefined && dto.email.trim().toLowerCase() !== existing.email
        ? await this.usersRepository.updateAndRevokeSessions(id, data)
        : await this.usersRepository.update(id, data);
      return this.toResponse(user);
    } catch (error) {
      this.rethrowPersistenceConflict(error);
      throw error;
    }
  }

  async deactivate(id: string, actorId: string): Promise<UserResponseDto> {
    if (id === actorId) {
      throw new ForbiddenException('No puedes desactivar tu propia cuenta.');
    }
    let result;
    try {
      result = await this.usersRepository.deactivate(id, actorId);
    } catch (error) {
      this.rethrowPersistenceConflict(error);
      throw error;
    }
    if (result.status === 'not-found') throw new NotFoundException('Usuario no encontrado.');
    if (result.status === 'last-administrator') {
      throw new ConflictException('Debe permanecer al menos un administrador activo.');
    }
    return this.toResponse(result.user);
  }

  async reactivate(id: string, actorId: string): Promise<UserResponseDto> {
    let user;
    try {
      user = await this.usersRepository.reactivate(id, actorId);
    } catch (error) {
      this.rethrowPersistenceConflict(error);
      throw error;
    }
    if (!user) throw new NotFoundException('Usuario no encontrado.');
    return this.toResponse(user);
  }

  async assignRole(
    id: string,
    dto: AssignRoleDto,
    actor: UserMutationActor,
  ): Promise<UserResponseDto> {
    if (id === actor.id) {
      throw new ForbiddenException('No puedes modificar tu propio rol.');
    }
    const role = await this.usersRepository.findRoleByKeyWithPermissions(dto.roleKey);
    if (!role) throw new NotFoundException(`Rol '${dto.roleKey}' no encontrado.`);
    this.assertCanAssignRole(actor.permissions, role);

    let result;
    try {
      result = await this.usersRepository.assignRole(
        id,
        role.id,
        role.updatedAt,
        actor.id,
      );
    } catch (error) {
      this.rethrowPersistenceConflict(error);
      throw error;
    }
    if (result.status === 'not-found') throw new NotFoundException('Usuario no encontrado.');
    if (result.status === 'role-not-found') throw new NotFoundException('Rol no encontrado.');
    if (result.status === 'stale-role') {
      throw new ConflictException(
        'El rol cambió durante la asignación. Revisa sus permisos e intenta nuevamente.',
      );
    }
    if (result.status === 'last-administrator') {
      throw new ConflictException('Debe permanecer al menos un administrador activo.');
    }
    return this.toResponse(result.user);
  }

  async resetPassword(
    id: string,
    dto: ResetUserPasswordDto,
    actorId: string,
  ): Promise<UserResponseDto> {
    if (id === actorId) {
      throw new ForbiddenException(
        'Para cambiar tu propia contraseña utiliza el flujo con verificación de credencial actual.',
      );
    }
    const existing = await this.usersRepository.findById(id);
    if (!existing) throw new NotFoundException('Usuario no encontrado.');
    if (await this.hashingService.compare(dto.newPassword, existing.passwordHash)) {
      throw new BadRequestException('La nueva contraseña debe ser diferente de la actual.');
    }

    const passwordHash = await this.hashingService.hash(dto.newPassword);
    try {
      const user = await this.usersRepository.updateAndRevokeSessions(id, {
        passwordHash,
        updatedBy: actorId,
      });
      return this.toResponse(user);
    } catch (error) {
      this.rethrowPersistenceConflict(error);
      throw error;
    }
  }

  async changeMyPassword(
    actorId: string,
    dto: ChangeMyPasswordDto,
  ): Promise<void> {
    const existing = await this.usersRepository.findById(actorId);
    if (!existing || !existing.isActive) throw new NotFoundException('Usuario no encontrado.');
    const currentMatches = await this.hashingService.compare(
      dto.currentPassword,
      existing.passwordHash,
    );
    if (!currentMatches) throw new BadRequestException('La contraseña actual no es correcta.');
    if (await this.hashingService.compare(dto.newPassword, existing.passwordHash)) {
      throw new BadRequestException('La nueva contraseña debe ser diferente de la actual.');
    }

    const passwordHash = await this.hashingService.hash(dto.newPassword);
    try {
      await this.usersRepository.updateAndRevokeSessions(actorId, {
        passwordHash,
        updatedBy: actorId,
      });
    } catch (error) {
      this.rethrowPersistenceConflict(error);
      throw error;
    }
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

  /** Para auth/JWT — obtiene estado y permisos actuales por id, nunca desde claims antiguos. */
  async findByIdWithPermissions(id: string): Promise<UserWithPermissionKeys | null> {
    const result = await this.usersRepository.findByIdWithPermissions(id);
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

  private assertCanAssignRole(
    actorPermissions: string[],
    role: RoleWithPermissionKeys,
  ): void {
    if (!actorPermissions.includes('admin.users.manage')) {
      throw new ForbiddenException('Se requiere administración de usuarios para asignar un rol.');
    }
    const actorPermissionSet = new Set(actorPermissions);
    const unauthorized = role.rolePermissions
      .map(({ permission }) => permission.key)
      .filter((permission) => !actorPermissionSet.has(permission));
    if (unauthorized.length > 0) {
      throw new ForbiddenException(
        'No puedes asignar un rol con permisos superiores a los tuyos.',
      );
    }
  }

  private rethrowPersistenceConflict(error: unknown): void {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return;
    if (error.code === 'P2002') {
      throw new ConflictException('El email, usuario o documento ya está registrado.');
    }
    if (error.code === 'P2034') {
      throw new ConflictException(
        'Otra operación modificó la cuenta al mismo tiempo. Intenta nuevamente.',
      );
    }
  }
}
