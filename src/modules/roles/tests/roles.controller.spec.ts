import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RoleResponseDto } from '../dto/role-response.dto';
import { RolesController } from '../roles.controller';
import { RolesService } from '../roles.service';

const mockRole: RoleResponseDto = {
  id: 'role-uuid-001',
  key: 'ADMINISTRADOR',
  name: 'Administrador',
  description: 'Acceso completo',
  permissions: [{ id: 'perm-uuid-001', key: 'users.read', description: null }],
  isSystem: true,
  userCount: 1,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
};

const mockRolesService = {
  findAll: jest.fn().mockResolvedValue([mockRole]),
  findOne: jest.fn().mockResolvedValue(mockRole),
  findPermissions: jest.fn().mockResolvedValue(mockRole.permissions),
  create: jest.fn().mockResolvedValue(mockRole),
  update: jest.fn().mockResolvedValue(mockRole),
  replacePermissions: jest.fn().mockResolvedValue(mockRole),
  delete: jest.fn().mockResolvedValue(undefined),
};

describe('RolesController', () => {
  let controller: RolesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RolesController],
      providers: [{ provide: RolesService, useValue: mockRolesService }],
    }).compile();

    controller = module.get(RolesController);
  });

  it('findAll delega en RolesService', async () => {
    const result = await controller.findAll();
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('ADMINISTRADOR');
  });

  it('findOne devuelve el rol correcto', async () => {
    const result = await controller.findOne('role-uuid-001');
    expect(result.id).toBe(mockRole.id);
  });

  it('findOne propaga NotFoundException', async () => {
    mockRolesService.findOne.mockRejectedValueOnce(new NotFoundException());
    await expect(controller.findOne('inexistente')).rejects.toThrow(NotFoundException);
  });

  it('atribuye al actor la actualización de la matriz de permisos', async () => {
    const dto = {
      permissionKeys: ['users.read'],
      expectedUpdatedAt: mockRole.updatedAt.toISOString(),
    };
    const request = {
      user: {
        sub: 'actor-uuid',
        email: 'actor@clinicview.local',
        username: 'actor',
        permissions: ['admin.roles.manage', 'users.read'],
        sessionVersion: 1,
        tokenType: 'access' as const,
      },
    };

    await controller.replacePermissions(mockRole.id, dto, request);

    expect(mockRolesService.replacePermissions).toHaveBeenCalledWith(
      mockRole.id,
      dto,
      request.user.permissions,
      request.user.sub,
    );
  });
});
