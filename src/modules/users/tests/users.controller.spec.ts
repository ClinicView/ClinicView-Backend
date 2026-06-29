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
  assignRole: jest.fn().mockResolvedValue(mockResponse),
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
      password: 'pass1234',
    };
    const result = await controller.create(dto);
    expect(mockUsersService.create).toHaveBeenCalledWith(dto);
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
    const result = await controller.deactivate(mockResponse.id);
    expect(result.isActive).toBe(false);
  });
});
