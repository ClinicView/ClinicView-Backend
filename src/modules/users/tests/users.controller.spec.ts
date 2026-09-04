import { Test, TestingModule } from '@nestjs/testing';
import { UserResponseDto } from '../dto/user-response.dto';
import { UsersController } from '../users.controller';
import { UsersService } from '../users.service';

const mockResponse: UserResponseDto = {
  id: 'a1b2c3d4-0000-0000-0000-000000000001',
  email: 'test@hospital.org',
  username: 'tuser',
  firstName: 'Test',
  lastName: 'User',
  fullName: 'Test User',
  documentType: null,
  documentNumber: null,
  profession: 'Médico',
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  roles: [],
};

const mockUsersService = {
  create: jest.fn().mockResolvedValue(mockResponse),
  findAll: jest.fn().mockResolvedValue([mockResponse]),
  findOne: jest.fn().mockResolvedValue(mockResponse),
  update: jest.fn().mockResolvedValue(mockResponse),
  deactivate: jest.fn().mockResolvedValue({ ...mockResponse, isActive: false }),
  reactivate: jest.fn().mockResolvedValue(mockResponse),
  assignRole: jest.fn().mockResolvedValue(mockResponse),
  resetPassword: jest.fn().mockResolvedValue(mockResponse),
  changeMyPassword: jest.fn().mockResolvedValue(undefined),
};

const request = {
  user: {
    sub: 'b1b2c3d4-0000-0000-0000-000000000002',
    email: 'admin@hospital.org',
    username: 'admin',
    permissions: ['users.create', 'admin.users.manage'],
    sessionVersion: 0,
    tokenType: 'access' as const,
  },
};

describe('UsersController', () => {
  let controller: UsersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get(UsersController);
  });

  it('create delega en UsersService', async () => {
    const dto = {
      email: 'x@x.com',
      username: 'xuser',
      firstName: 'X',
      lastName: 'User',
      password: 'password1234',
    };
    const result = await controller.create(dto, request);
    expect(mockUsersService.create).toHaveBeenCalledWith(dto, {
      id: request.user.sub,
      permissions: request.user.permissions,
    });
    expect(result).toEqual(mockResponse);
  });

  it('findAll devuelve un array', async () => {
    const result = await controller.findAll();
    expect(Array.isArray(result)).toBe(true);
  });

  it('findOne delega en UsersService con el id', async () => {
    await controller.findOne(mockResponse.id);
    expect(mockUsersService.findOne).toHaveBeenCalledWith(mockResponse.id);
  });

  it('deactivate devuelve el usuario con isActive=false', async () => {
    const result = await controller.deactivate(mockResponse.id, request);
    expect(result.isActive).toBe(false);
  });

  it('reactivate atribuye la mutación al actor autenticado', async () => {
    await controller.reactivate(mockResponse.id, request);
    expect(mockUsersService.reactivate).toHaveBeenCalledWith(mockResponse.id, request.user.sub);
  });

  it('changeMyPassword no devuelve la credencial', async () => {
    const dto = { currentPassword: 'current-pass-123', newPassword: 'new-password-123' };
    await expect(controller.changeMyPassword(dto, request)).resolves.toBeUndefined();
    expect(mockUsersService.changeMyPassword).toHaveBeenCalledWith(request.user.sub, dto);
  });
});
