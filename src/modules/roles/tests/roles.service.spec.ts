import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { RoleWithPermissions } from '../repositories/roles.repository';
import { RolesRepository } from '../repositories/roles.repository';
import { RolesService } from '../roles.service';

const updatedAt = new Date('2026-01-02T00:00:00.000Z');

function makeRole(
  key = 'MEDICO',
  permissionKeys = ['patients.read'],
  userCount = 0,
): RoleWithPermissions {
  return {
    id: 'a1b2c3d4-0000-0000-0000-000000000001',
    key,
    name: key === 'ADMINISTRADOR' ? 'Administrador' : 'Médico',
    description: 'Rol de prueba',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt,
    _count: { userRoles: userCount },
    rolePermissions: permissionKeys.map((permissionKey, index) => ({
      roleId: 'a1b2c3d4-0000-0000-0000-000000000001',
      permissionId: `b1b2c3d4-0000-0000-0000-00000000000${index}`,
      permission: {
        id: `b1b2c3d4-0000-0000-0000-00000000000${index}`,
        key: permissionKey,
        description: permissionKey,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    })),
  };
}

describe('RolesService', () => {
  let service: RolesService;
  let repo: jest.Mocked<RolesRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        {
          provide: RolesRepository,
          useValue: {
            findMany: jest.fn(),
            findById: jest.fn(),
            findByKey: jest.fn(),
            findPermissions: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            replacePermissions: jest.fn(),
            delete: jest.fn(),
          } satisfies Record<keyof RolesRepository, jest.Mock>,
        },
      ],
    }).compile();
    service = module.get(RolesService);
    repo = module.get(RolesRepository);
  });

  it('expone protección de sistema, conteo y versión del rol', async () => {
    repo.findMany.mockResolvedValue([makeRole('MEDICO', ['patients.read'], 4)]);
    const [result] = await service.findAll();
    expect(result).toMatchObject({ isSystem: true, userCount: 4, updatedAt });
    expect(result.permissions[0].key).toBe('patients.read');
  });

  it('crea un rol personalizado sin permisos', async () => {
    repo.findByKey.mockResolvedValue(null);
    repo.create.mockResolvedValue(makeRole('ENFERMERIA', []));
    const result = await service.create({ key: 'ENFERMERIA', name: 'Enfermería' });
    expect(repo.create).toHaveBeenCalledWith({
      key: 'ENFERMERIA', name: 'Enfermería', description: null,
    });
    expect(result.isSystem).toBe(false);
  });

  it('rechaza administrar un rol con permisos superiores a los del actor', async () => {
    repo.findById.mockResolvedValue(makeRole('CUSTOM', ['admin.audit.read']));
    await expect(service.replacePermissions(
      'role-id',
      { permissionKeys: [], expectedUpdatedAt: updatedAt.toISOString() },
      ['admin.roles.manage'],
      'actor-id',
    )).rejects.toThrow(ForbiddenException);
    expect(repo.replacePermissions).not.toHaveBeenCalled();
  });

  it('impide retirar capacidades críticas al Administrador', async () => {
    const required = [
      'users.read', 'users.create', 'users.update', 'users.deactivate', 'roles.read',
      'roles.manage', 'admin.users.manage', 'admin.roles.manage', 'admin.audit.read',
    ];
    repo.findById.mockResolvedValue(makeRole('ADMINISTRADOR', required));
    await expect(service.replacePermissions(
      'role-id',
      { permissionKeys: required.filter((key) => key !== 'admin.roles.manage'), expectedUpdatedAt: updatedAt.toISOString() },
      required,
      'actor-id',
    )).rejects.toThrow(ConflictException);
  });

  it('reemplaza permisos usando control de concurrencia', async () => {
    const role = makeRole('CUSTOM', ['patients.read']);
    repo.findById.mockResolvedValue(role);
    repo.replacePermissions.mockResolvedValue({ status: 'updated', role });
    await service.replacePermissions(
      role.id,
      { permissionKeys: ['patients.read'], expectedUpdatedAt: updatedAt.toISOString() },
      ['admin.roles.manage', 'patients.read'],
      'actor-id',
    );
    expect(repo.replacePermissions).toHaveBeenCalledWith(
      role.id,
      ['patients.read'],
      updatedAt,
      'actor-id',
    );
  });

  it('convierte una versión obsoleta en conflicto', async () => {
    const role = makeRole('CUSTOM');
    repo.findById.mockResolvedValue(role);
    repo.update.mockResolvedValue({ status: 'stale' });
    await expect(service.update(role.id, {
      name: 'Nuevo', expectedUpdatedAt: updatedAt.toISOString(),
    })).rejects.toThrow(ConflictException);
  });

  it('protege roles base y roles personalizados en uso al eliminar', async () => {
    repo.findById.mockResolvedValue(makeRole('MEDICO'));
    await expect(service.delete('role-id', updatedAt.toISOString())).rejects.toThrow(ConflictException);
    repo.findById.mockResolvedValue(makeRole('CUSTOM', [], 2));
    repo.delete.mockResolvedValue({ status: 'in-use', userCount: 2 });
    await expect(service.delete('role-id', updatedAt.toISOString())).rejects.toThrow(ConflictException);
  });

  it('propaga no encontrado', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });
});
