import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { HashingService } from '../../../core/security/hashing.service';
import { UsersService, UserWithPermissionKeys } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { RefreshTokensRepository } from '../repositories/refresh-tokens.repository';

const mockUser: UserWithPermissionKeys = {
  user: {
    id: 'uuid-user-001',
    email: 'medico@hospital.org',
    username: 'medico',
    firstName: 'Dr.',
    lastName: 'Ejemplo',
    fullName: 'Dr. Ejemplo',
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
  },
  permissionKeys: ['patients.read', 'records.read'],
};

const jwtPayload: JwtPayload = {
  sub: 'uuid-user-001',
  email: 'medico@hospital.org',
  permissions: ['patients.read', 'records.read'],
};

const mockRefreshTokensRepo = {
  store: jest.fn().mockResolvedValue(undefined),
  findByHash: jest.fn(),
  rotate: jest.fn().mockResolvedValue(undefined),
  deleteByHash: jest.fn().mockResolvedValue(undefined),
  deleteExpiredForUser: jest.fn().mockResolvedValue(undefined),
} satisfies Record<keyof RefreshTokensRepository, jest.Mock>;

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Pick<UsersService, 'findByEmailWithPermissions' | 'updateLastLogin'>>;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign' | 'verify'>>;
  let hashingService: jest.Mocked<Pick<HashingService, 'compare'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmailWithPermissions: jest.fn(),
            updateLastLogin: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('signed-token'),
            verify: jest.fn(),
          },
        },
        {
          provide: HashingService,
          useValue: { compare: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(604800),
            getOrThrow: jest.fn().mockReturnValue('test-refresh-secret'),
          },
        },
        { provide: RefreshTokensRepository, useValue: mockRefreshTokensRepo },
      ],
    }).compile();

    service = module.get(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    hashingService = module.get(HashingService);
    jest.clearAllMocks();
  });

  // ─── validateUser ─────────────────────────────────────────────────────────────

  describe('validateUser', () => {
    it('devuelve payload JWT cuando las credenciales son correctas', async () => {
      (usersService.findByEmailWithPermissions as jest.Mock).mockResolvedValue(mockUser);
      (hashingService.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('medico@hospital.org', 'password123');

      expect(result.sub).toBe(mockUser.user.id);
      expect(result.email).toBe(mockUser.user.email);
      expect(result.permissions).toEqual(mockUser.permissionKeys);
    });

    it('lanza UnauthorizedException si el usuario no existe', async () => {
      (usersService.findByEmailWithPermissions as jest.Mock).mockResolvedValue(null);
      await expect(service.validateUser('noexiste@hospital.org', 'pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lanza UnauthorizedException si el usuario está inactivo', async () => {
      (usersService.findByEmailWithPermissions as jest.Mock).mockResolvedValue({
        ...mockUser,
        user: { ...mockUser.user, isActive: false },
      });
      await expect(service.validateUser('medico@hospital.org', 'pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lanza UnauthorizedException si la contraseña es inválida', async () => {
      (usersService.findByEmailWithPermissions as jest.Mock).mockResolvedValue(mockUser);
      (hashingService.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.validateUser('medico@hospital.org', 'wrong-pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('nunca expone el passwordHash en el payload', async () => {
      (usersService.findByEmailWithPermissions as jest.Mock).mockResolvedValue(mockUser);
      (hashingService.compare as jest.Mock).mockResolvedValue(true);
      const result = await service.validateUser('medico@hospital.org', 'password123');
      expect(result).not.toHaveProperty('passwordHash');
    });
  });

  // ─── login ────────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('emite access_token y refresh_token', async () => {
      (jwtService.sign as jest.Mock)
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      mockRefreshTokensRepo.deleteExpiredForUser.mockResolvedValue(undefined);
      mockRefreshTokensRepo.store.mockResolvedValue(undefined);
      (usersService.updateLastLogin as jest.Mock).mockResolvedValue(undefined);

      const result = await service.login(jwtPayload);

      expect(result.access_token).toBe('access-token');
      expect(result.refresh_token).toBe('refresh-token');
      expect(result.token_type).toBe('Bearer');
    });

    it('almacena el hash del refresh token en BD', async () => {
      (jwtService.sign as jest.Mock)
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      mockRefreshTokensRepo.deleteExpiredForUser.mockResolvedValue(undefined);
      mockRefreshTokensRepo.store.mockResolvedValue(undefined);
      (usersService.updateLastLogin as jest.Mock).mockResolvedValue(undefined);

      await service.login(jwtPayload);

      expect(mockRefreshTokensRepo.store).toHaveBeenCalledWith(
        jwtPayload.sub,
        expect.any(String),
        expect.any(Date),
      );
      // Verifica que no almacena el token en claro
      const storedHash = mockRefreshTokensRepo.store.mock.calls[0][1] as string;
      expect(storedHash).not.toBe('refresh-token');
      expect(storedHash).toHaveLength(64); // SHA-256 hex = 64 chars
    });

    it('limpia tokens expirados antes de almacenar el nuevo', async () => {
      (jwtService.sign as jest.Mock)
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      mockRefreshTokensRepo.deleteExpiredForUser.mockResolvedValue(undefined);
      mockRefreshTokensRepo.store.mockResolvedValue(undefined);
      (usersService.updateLastLogin as jest.Mock).mockResolvedValue(undefined);

      await service.login(jwtPayload);

      expect(mockRefreshTokensRepo.deleteExpiredForUser).toHaveBeenCalledWith(jwtPayload.sub);
    });

    it('registra el último acceso del usuario', async () => {
      (jwtService.sign as jest.Mock)
        .mockReturnValueOnce('access-token')
        .mockReturnValueOnce('refresh-token');
      mockRefreshTokensRepo.deleteExpiredForUser.mockResolvedValue(undefined);
      mockRefreshTokensRepo.store.mockResolvedValue(undefined);
      (usersService.updateLastLogin as jest.Mock).mockResolvedValue(undefined);

      await service.login(jwtPayload);
      expect(usersService.updateLastLogin).toHaveBeenCalledWith(jwtPayload.sub);
    });
  });

  // ─── refresh ──────────────────────────────────────────────────────────────────

  describe('refresh', () => {
    it('emite un nuevo par de tokens con permisos actualizados', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'uuid-user-001', email: 'medico@hospital.org' });
      mockRefreshTokensRepo.findByHash.mockResolvedValue({ userId: 'uuid-user-001' });
      (usersService.findByEmailWithPermissions as jest.Mock).mockResolvedValue(mockUser);
      (jwtService.sign as jest.Mock)
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');
      mockRefreshTokensRepo.rotate.mockResolvedValue(undefined);

      const result = await service.refresh('valid-refresh-token');

      expect(result.access_token).toBe('new-access-token');
      expect(result.refresh_token).toBe('new-refresh-token');
    });

    it('rota el hash en BD (delete + insert atómico)', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'uuid-user-001', email: 'medico@hospital.org' });
      mockRefreshTokensRepo.findByHash.mockResolvedValue({ userId: 'uuid-user-001' });
      (usersService.findByEmailWithPermissions as jest.Mock).mockResolvedValue(mockUser);
      (jwtService.sign as jest.Mock)
        .mockReturnValueOnce('new-access-token')
        .mockReturnValueOnce('new-refresh-token');
      mockRefreshTokensRepo.rotate.mockResolvedValue(undefined);

      await service.refresh('valid-refresh-token');

      expect(mockRefreshTokensRepo.rotate).toHaveBeenCalledWith(
        expect.any(String),
        mockUser.user.id,
        expect.any(String),
        expect.any(Date),
      );
    });

    it('lanza UnauthorizedException si el refresh token es inválido (firma mala)', async () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => { throw new Error('invalid token'); });
      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException si el token fue revocado (no está en BD)', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'uuid-user-001', email: 'medico@hospital.org' });
      mockRefreshTokensRepo.findByHash.mockResolvedValue(null);

      await expect(service.refresh('revoked-token')).rejects.toThrow(UnauthorizedException);
    });

    it('lanza UnauthorizedException si el usuario ya no está disponible', async () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'uuid-user-001', email: 'medico@hospital.org' });
      mockRefreshTokensRepo.findByHash.mockResolvedValue({ userId: 'uuid-user-001' });
      (usersService.findByEmailWithPermissions as jest.Mock).mockResolvedValue(null);

      await expect(service.refresh('valid-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─── logout ───────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('elimina el hash del refresh token de la BD', async () => {
      mockRefreshTokensRepo.deleteByHash.mockResolvedValue(undefined);

      await service.logout('some-refresh-token');

      expect(mockRefreshTokensRepo.deleteByHash).toHaveBeenCalledWith(expect.any(String));
      // Verifica que el hash enviado no es el token en claro
      const deletedHash = mockRefreshTokensRepo.deleteByHash.mock.calls[0][0] as string;
      expect(deletedHash).not.toBe('some-refresh-token');
      expect(deletedHash).toHaveLength(64);
    });

    it('es idempotente: no lanza si el token ya fue revocado', async () => {
      mockRefreshTokensRepo.deleteByHash.mockResolvedValue(undefined);
      await expect(service.logout('already-revoked-token')).resolves.toBeUndefined();
    });
  });
});
