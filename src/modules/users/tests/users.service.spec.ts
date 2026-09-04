import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HashingService } from '../../../core/security/hashing.service';
import type {
  RoleWithPermissionKeys,
  UserWithRoles,
} from '../repositories/users.repository';
import { UsersRepository } from '../repositories/users.repository';
import { UsersService } from '../users.service';

const actor = {
  id: 'b1b2c3d4-0000-0000-0000-000000000002',
  permissions: ['users.create', 'admin.users.manage', 'patients.read'],
};

const makeUser = (overrides: Partial<UserWithRoles> = {}): UserWithRoles => ({
  id: 'a1b2c3d4-0000-0000-0000-000000000001',
  email: 'test@hospital.org',
  username: 'tuser',
  firstName: 'Test',
  lastName: 'User',
  fullName: 'Test User',
  documentType: null,
  documentNumber: null,
  profession: 'Médico',
  passwordHash: '$2b$12$hashed',
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date('2026-01-01'),
  createdBy: null,
  updatedAt: new Date('2026-01-01'),
  updatedBy: null,
  version: 0,
  sessionVersion: 0,
  userRoles: [],
  ...overrides,
});

const makeRole = (
  key = 'MEDICO',
  permissionKeys = ['patients.read'],
): RoleWithPermissionKeys => ({
  id: 'c1b2c3d4-0000-0000-0000-000000000003',
  key,
  name: key,
  description: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  rolePermissions: permissionKeys.map((permissionKey, index) => ({
    roleId: 'c1b2c3d4-0000-0000-0000-000000000003',
    permissionId: `d1b2c3d4-0000-0000-0000-00000000000${index}`,
    permission: { key: permissionKey },
  })),
});

describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<UsersRepository>;
  let hashing: jest.Mocked<Pick<HashingService, 'hash' | 'compare'>>;
  const mockUser = makeUser();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useValue: {
            create: jest.fn(),
            createWithRoleGuard: jest.fn(),
            findMany: jest.fn(),
            findById: jest.fn(),
            findByEmail: jest.fn(),
            findByUsername: jest.fn(),
            findByDocumentNumber: jest.fn(),
            update: jest.fn(),
            updateAndRevokeSessions: jest.fn(),
            deactivate: jest.fn(),
            reactivate: jest.fn(),
            assignRole: jest.fn(),
            findRoleByKey: jest.fn(),
            findRoleByKeyWithPermissions: jest.fn(),
            findByEmailWithPermissions: jest.fn(),
            findByIdWithPermissions: jest.fn(),
            updateLastLogin: jest.fn(),
            searchActiveProfessionals: jest.fn(),
          } satisfies Record<keyof UsersRepository, jest.Mock>,
        },
        {
          provide: HashingService,
          useValue: {
            hash: jest.fn().mockResolvedValue('$2b$12$newhash'),
            compare: jest.fn().mockResolvedValue(false),
          },
        },
      ],
    }).compile();
    service = module.get(UsersService);
    repo = module.get(UsersRepository);
    hashing = module.get(HashingService);
    repo.findByEmail.mockResolvedValue(null);
    repo.findByUsername.mockResolvedValue(null);
    repo.findByDocumentNumber.mockResolvedValue(null);
  });

  it('crea un usuario normalizado, atribuido y sin exponer el hash', async () => {
    repo.create.mockResolvedValue(mockUser);
    const result = await service.create({
      email: 'TEST@hospital.org', username: 'tuser', firstName: 'Test', lastName: 'User',
      password: 'password1234',
    }, actor);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'test@hospital.org', createdBy: actor.id, updatedBy: actor.id,
      passwordHash: '$2b$12$newhash',
    }));
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('exige administración fuerte si la creación incluye un rol', async () => {
    repo.findRoleByKeyWithPermissions.mockResolvedValue(makeRole());
    await expect(service.create({
      email: 'x@hospital.org', username: 'xuser', firstName: 'Xx', lastName: 'User',
      password: 'password1234', roleKey: 'MEDICO',
    }, { id: actor.id, permissions: ['users.create'] })).rejects.toThrow(ForbiddenException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('crea con rol mediante una guarda transaccional de su versión autorizada', async () => {
    const role = makeRole();
    repo.findRoleByKeyWithPermissions.mockResolvedValue(role);
    repo.createWithRoleGuard.mockResolvedValue({ status: 'created', user: mockUser });

    await service.create({
      email: 'x@hospital.org', username: 'xuser', firstName: 'Xx', lastName: 'User',
      password: 'password1234', roleKey: role.key,
    }, actor);

    expect(repo.createWithRoleGuard).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'x@hospital.org' }),
      role.id,
      role.updatedAt,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('impide asignar un rol con permisos superiores a los del actor', async () => {
    repo.findRoleByKeyWithPermissions.mockResolvedValue(makeRole('SUPERIOR', ['admin.audit.read']));
    await expect(service.assignRole(mockUser.id, { roleKey: 'SUPERIOR' }, actor))
      .rejects.toThrow(ForbiddenException);
    expect(repo.assignRole).not.toHaveBeenCalled();
  });

  it('asigna un rol permitido y procesa el resultado protegido', async () => {
    const role = makeRole();
    const assignedUser = makeUser({
      userRoles: [{
        userId: mockUser.id,
        roleId: role.id,
        role: { key: role.key, name: role.name },
      }],
    });
    repo.findRoleByKeyWithPermissions.mockResolvedValue(role);
    repo.assignRole.mockResolvedValue({ status: 'updated', user: assignedUser });
    const result = await service.assignRole(mockUser.id, { roleKey: role.key }, actor);
    expect(repo.assignRole).toHaveBeenCalledWith(
      mockUser.id,
      role.id,
      role.updatedAt,
      actor.id,
    );
    expect(result.roles[0].key).toBe('MEDICO');
  });

  it('protege al último administrador y la propia cuenta', async () => {
    await expect(service.deactivate(actor.id, actor.id)).rejects.toThrow(ForbiddenException);
    repo.deactivate.mockResolvedValue({ status: 'last-administrator' });
    await expect(service.deactivate(mockUser.id, actor.id)).rejects.toThrow(ConflictException);
  });

  it('reactiva usuarios preservando la identidad', async () => {
    repo.reactivate.mockResolvedValue(makeUser({ isActive: true }));
    const result = await service.reactivate(mockUser.id, actor.id);
    expect(repo.reactivate).toHaveBeenCalledWith(mockUser.id, actor.id);
    expect(result.isActive).toBe(true);
  });

  it('actualizar email revoca sesiones y conserva el password fuera del DTO', async () => {
    repo.findById.mockResolvedValue(mockUser);
    repo.updateAndRevokeSessions.mockResolvedValue(makeUser({ email: 'new@hospital.org' }));
    await service.update(mockUser.id, { email: 'NEW@hospital.org' }, actor.id);
    expect(repo.updateAndRevokeSessions).toHaveBeenCalledWith(mockUser.id, expect.objectContaining({
      email: 'new@hospital.org', updatedBy: actor.id,
    }));
    expect(hashing.hash).not.toHaveBeenCalled();
  });

  it('restablece credencial ajena y revoca todas sus sesiones', async () => {
    repo.findById.mockResolvedValue(mockUser);
    repo.updateAndRevokeSessions.mockResolvedValue(mockUser);
    await service.resetPassword(mockUser.id, { newPassword: 'new-password-123' }, actor.id);
    expect(hashing.hash).toHaveBeenCalledWith('new-password-123');
    expect(repo.updateAndRevokeSessions).toHaveBeenCalledWith(mockUser.id, {
      passwordHash: '$2b$12$newhash', updatedBy: actor.id,
    });
    await expect(service.resetPassword(actor.id, { newPassword: 'new-password-123' }, actor.id))
      .rejects.toThrow(ForbiddenException);
  });

  it('cambio propio verifica la credencial actual antes de revocar sesiones', async () => {
    repo.findById.mockResolvedValue(mockUser);
    hashing.compare.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    repo.updateAndRevokeSessions.mockResolvedValue(mockUser);
    await service.changeMyPassword(mockUser.id, {
      currentPassword: 'old-password-123', newPassword: 'new-password-123',
    });
    expect(repo.updateAndRevokeSessions).toHaveBeenCalled();
  });

  it('rechaza una credencial actual incorrecta', async () => {
    repo.findById.mockResolvedValue(mockUser);
    hashing.compare.mockResolvedValue(false);
    await expect(service.changeMyPassword(mockUser.id, {
      currentPassword: 'wrong-password', newPassword: 'new-password-123',
    })).rejects.toThrow(BadRequestException);
  });

  it('propaga no encontrado en consultas', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });
});
