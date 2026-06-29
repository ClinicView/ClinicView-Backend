import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RoleResponseDto } from '../dto/role-response.dto';
import { RoleWithPermissions, RolesRepository } from '../repositories/roles.repository';
import { RolesService } from '../roles.service';

const mockRole: RoleWithPermissions = {
  id: 'role-uuid-001',
  key: 'ADMINISTRADOR',
  name: 'Administrador',
  description: 'Acceso completo',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  rolePermissions: [
    {
      roleId: 'role-uuid-001',
      permissionId: 'perm-uuid-001',
      permission: {
        id: 'perm-uuid-001',
        key: 'users.read',
        description: 'Consultar usuarios',
        createdAt: new Date('2026-01-01'),
      },
    },
  ],
};

const mockRolesRepository = {
  findMany: jest.fn().mockResolvedValue([mockRole]),
  findById: jest.fn().mockResolvedValue(mockRole),
};

describe('RolesService', () => {
  let service: RolesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: RolesRepository, useValue: mockRolesRepository },
      ],
    }).compile();

    service = module.get(RolesService);
    jest.clearAllMocks();
    mockRolesRepository.findMany.mockResolvedValue([mockRole]);
    mockRolesRepository.findById.mockResolvedValue(mockRole);
  });

  describe('findAll', () => {
    it('devuelve lista de roles con permisos', async () => {
      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('ADMINISTRADOR');
      expect(result[0].permissions).toHaveLength(1);
      expect(result[0].permissions[0].key).toBe('users.read');
    });

    it('no expone el campo updatedAt del rol (no está en el DTO)', async () => {
      const result: RoleResponseDto[] = await service.findAll();
      expect(result[0]).not.toHaveProperty('updatedAt');
    });
  });

  describe('findOne', () => {
    it('devuelve el rol si existe', async () => {
      const result = await service.findOne('role-uuid-001');
      expect(result.id).toBe(mockRole.id);
      expect(result.name).toBe(mockRole.name);
    });

    it('lanza NotFoundException si el rol no existe', async () => {
      mockRolesRepository.findById.mockResolvedValue(null);
      await expect(service.findOne('inexistente')).rejects.toThrow(NotFoundException);
    });
  });
});
