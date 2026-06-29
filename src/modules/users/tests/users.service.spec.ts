import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HashingService } from '../../../core/security/hashing.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import type { UserWithRoles } from '../repositories/users.repository';
import { UsersRepository } from '../repositories/users.repository';
import { UsersService } from '../users.service';

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
  userRoles: [],
  ...overrides,
});

const mockUser = makeUser();

describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<UsersRepository>;
  let hashing: jest.Mocked<Pick<HashingService, 'hash' | 'compare'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useValue: {
            create: jest.fn(),
            findMany: jest.fn(),
            findById: jest.fn(),
            findByEmail: jest.fn(),
            findByUsername: jest.fn(),
            findByDocumentNumber: jest.fn(),
            update: jest.fn(),
            deactivate: jest.fn(),
            assignRole: jest.fn(),
            findRoleByKey: jest.fn(),
            findByEmailWithPermissions: jest.fn(),
            updateLastLogin: jest.fn(),
          } satisfies Record<keyof UsersRepository, jest.Mock>,
        },
        {
          provide: HashingService,
          useValue: {
            hash: jest.fn().mockResolvedValue('$2b$12$newhash'),
            compare: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(UsersService);
    repo = module.get(UsersRepository);
    hashing = module.get(HashingService);
  });

  // ─── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    const dto: CreateUserDto = {
      email: 'test@hospital.org',
      username: 'tuser',
      firstName: 'Test',
      lastName: 'User',
      profession: 'Médico',
      password: 'securepass1',
    };

    it('crea el usuario y hashea la contraseña', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.findByUsername.mockResolvedValue(null);
      repo.findByDocumentNumber.mockResolvedValue(null);
      repo.create.mockResolvedValue(mockUser);

      const result = await service.create(dto);

      expect(repo.findByEmail).toHaveBeenCalledWith(dto.email);
      expect(repo.findByUsername).toHaveBeenCalledWith(dto.username);
      expect(hashing.hash).toHaveBeenCalledWith(dto.password);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: dto.email,
          username: dto.username,
          firstName: dto.firstName,
          lastName: dto.lastName,
          fullName: 'Test User',
          passwordHash: '$2b$12$newhash',
        }),
      );
      expect(result.id).toBe(mockUser.id);
    });

    it('no expone passwordHash en la respuesta', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.findByUsername.mockResolvedValue(null);
      repo.create.mockResolvedValue(mockUser);

      const result = await service.create(dto);

      expect(result).not.toHaveProperty('passwordHash');
    });

    it('lanza ConflictException si el email ya existe', async () => {
      repo.findByEmail.mockResolvedValue(mockUser);
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('lanza ConflictException si el usuario ya existe', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.findByUsername.mockResolvedValue(mockUser);
      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });
  });

  // ─── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('devuelve la lista de usuarios mapeada a DTO', async () => {
      repo.findMany.mockResolvedValue([mockUser]);
      const result = await service.findAll();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockUser.id);
    });
  });

  // ─── findOne ─────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('devuelve el usuario si existe', async () => {
      repo.findById.mockResolvedValue(mockUser);
      const result = await service.findOne(mockUser.id);
      expect(result.email).toBe(mockUser.email);
    });

    it('lanza NotFoundException si no existe', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.findOne('id-inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── update ──────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('actualiza nombres y fullName sin hashear si no hay contraseña nueva', async () => {
      const dto: UpdateUserDto = { firstName: 'Nuevo', lastName: 'Nombre' };
      repo.findById.mockResolvedValue(mockUser);
      repo.update.mockResolvedValue(
        makeUser({ firstName: 'Nuevo', lastName: 'Nombre', fullName: 'Nuevo Nombre' }),
      );

      const result = await service.update(mockUser.id, dto);

      expect(hashing.hash).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(
        mockUser.id,
        expect.objectContaining({ firstName: 'Nuevo', lastName: 'Nombre', fullName: 'Nuevo Nombre' }),
      );
      expect(result.fullName).toBe('Nuevo Nombre');
    });

    it('hashea la contraseña cuando se provee una nueva', async () => {
      const dto: UpdateUserDto = { password: 'nueva-pass-segura' };
      repo.findById.mockResolvedValue(mockUser);
      repo.update.mockResolvedValue(mockUser);

      await service.update(mockUser.id, dto);

      expect(hashing.hash).toHaveBeenCalledWith('nueva-pass-segura');
    });

    it('lanza NotFoundException si el usuario no existe', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.update('inexistente', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ─── deactivate ───────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    it('desactiva el usuario (borrado lógico)', async () => {
      repo.findById.mockResolvedValue(mockUser);
      repo.deactivate.mockResolvedValue(makeUser({ isActive: false }));

      const result = await service.deactivate(mockUser.id);

      expect(repo.deactivate).toHaveBeenCalledWith(mockUser.id);
      expect(result.isActive).toBe(false);
    });

    it('lanza NotFoundException si el usuario no existe', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.deactivate('inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── assignRole ──────────────────────────────────────────────────────────────

  describe('assignRole', () => {
    const mockRole = { id: 'role-id', key: 'MEDICO', name: 'Médico', description: null, createdAt: new Date(), updatedAt: new Date() };

    it('asigna el rol al usuario', async () => {
      repo.findById.mockResolvedValue(mockUser);
      repo.findRoleByKey.mockResolvedValue(mockRole);
      repo.assignRole.mockResolvedValue(makeUser({ userRoles: [{ roleId: mockRole.id, userId: mockUser.id, role: { key: 'MEDICO', name: 'Médico' } }] }));

      const result = await service.assignRole(mockUser.id, { roleKey: 'MEDICO' });

      expect(repo.findRoleByKey).toHaveBeenCalledWith('MEDICO');
      expect(repo.assignRole).toHaveBeenCalledWith(mockUser.id, mockRole.id);
      expect(result.roles[0].key).toBe('MEDICO');
    });

    it('lanza NotFoundException si el usuario no existe', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.assignRole('no-existe', { roleKey: 'MEDICO' })).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si el rol no existe', async () => {
      repo.findById.mockResolvedValue(mockUser);
      repo.findRoleByKey.mockResolvedValue(null);
      await expect(service.assignRole(mockUser.id, { roleKey: 'ROL_INVALIDO' })).rejects.toThrow(NotFoundException);
    });
  });
});
