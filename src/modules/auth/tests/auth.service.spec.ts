import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { HashingService } from '../../../core/security/hashing.service';
import { UsersService, UserWithPermissionKeys } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { JwtPayload, RefreshJwtPayload } from '../interfaces/jwt-payload.interface';
import { RefreshTokensRepository } from '../repositories/refresh-tokens.repository';

const mockUser: UserWithPermissionKeys = {
  user: {
    id: 'f9b3308d-cc74-4f30-823a-75ca624ff69f',
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
    sessionVersion: 3,
  },
  permissionKeys: ['patients.read', 'records.read'],
};

const jwtPayload: JwtPayload = {
  sub: mockUser.user.id,
  email: mockUser.user.email,
  permissions: mockUser.permissionKeys,
  sessionVersion: mockUser.user.sessionVersion,
  tokenType: 'access',
};

const refreshPayload: RefreshJwtPayload = {
  sub: mockUser.user.id,
  sessionVersion: mockUser.user.sessionVersion,
  tokenType: 'refresh',
  jti: '86aa1b35-01c6-431c-bc30-00645c3e61d2',
};

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findByEmailWithPermissions' | 'findByIdWithPermissions'>
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign' | 'verify'>>;
  let hashingService: jest.Mocked<Pick<HashingService, 'compare'>>;
  let refreshTokensRepo: jest.Mocked<RefreshTokensRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmailWithPermissions: jest.fn(),
            findByIdWithPermissions: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn((payload: { tokenType?: string }) =>
              payload.tokenType === 'refresh' ? 'refresh-token' : 'access-token',
            ),
            verify: jest.fn(),
          },
        },
        { provide: HashingService, useValue: { compare: jest.fn() } },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback: number) => {
              const values: Record<string, number> = {
                'jwt.expiresInSeconds': 900,
                'jwtRefresh.sessionExpiresInSeconds': 86_400,
                'jwtRefresh.expiresInSeconds': 604_800,
              };
              return values[key] ?? fallback;
            }),
            getOrThrow: jest.fn().mockReturnValue('test-refresh-secret'),
          },
        },
        {
          provide: RefreshTokensRepository,
          useValue: {
            createSession: jest.fn().mockResolvedValue(true),
            findActiveByHash: jest.fn(),
            rotate: jest.fn().mockResolvedValue(true),
            deleteByHash: jest.fn().mockResolvedValue(mockUser.user.id),
          },
        },
      ],
    }).compile();

    service = module.get(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    hashingService = module.get(HashingService);
    refreshTokensRepo = module.get(RefreshTokensRepository);
  });

  describe('validateUser', () => {
    it('normaliza el email y devuelve versión/permisos actuales', async () => {
      usersService.findByEmailWithPermissions.mockResolvedValue(mockUser);
      hashingService.compare.mockResolvedValue(true);

      await expect(service.validateUser(' MEDICO@Hospital.org ', 'password123')).resolves.toEqual(
        jwtPayload,
      );
      expect(usersService.findByEmailWithPermissions).toHaveBeenCalledWith('medico@hospital.org');
    });

    it.each([
      ['usuario inexistente', null, true],
      ['usuario inactivo', { ...mockUser, user: { ...mockUser.user, isActive: false } }, true],
    ])('rechaza %s', async (_label, user, passwordValid) => {
      usersService.findByEmailWithPermissions.mockResolvedValue(user);
      hashingService.compare.mockResolvedValue(passwordValid);
      await expect(service.validateUser('medico@hospital.org', 'password123')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rechaza una contraseña incorrecta', async () => {
      usersService.findByEmailWithPermissions.mockResolvedValue(mockUser);
      hashingService.compare.mockResolvedValue(false);
      await expect(service.validateUser('medico@hospital.org', 'incorrecta')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('login', () => {
    it('crea sesión de navegador y devuelve solo access token breve', async () => {
      const result = await service.login(jwtPayload, false);

      expect(result.response).toEqual({
        access_token: 'access-token',
        token_type: 'Bearer',
        expires_in: 900,
      });
      expect(result.response).not.toHaveProperty('refresh_token');
      expect(result.actorId).toBe(jwtPayload.sub);
      expect(result.rememberMe).toBe(false);
      expect(refreshTokensRepo.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: jwtPayload.sub,
          sessionVersion: 3,
          rememberMe: false,
          tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
        expect.any(Date),
      );
      const stored = refreshTokensRepo.createSession.mock.calls[0][0];
      expect(stored.tokenHash).not.toBe(result.refreshToken);
      expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 86_000_000);
    });

    it('usa la vigencia persistente cuando rememberMe está activo', async () => {
      const result = await service.login(jwtPayload, true);
      expect(result.rememberMe).toBe(true);
      expect(result.refreshExpiresAt.getTime()).toBeGreaterThan(Date.now() + 604_000_000);
    });

    it('rechaza si el usuario cambió antes de persistir la sesión', async () => {
      refreshTokensRepo.createSession.mockResolvedValue(false);
      await expect(service.login(jwtPayload)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    const expiresAt = new Date(Date.now() + 3_600_000);

    beforeEach(() => {
      jwtService.verify.mockReturnValue(refreshPayload);
      refreshTokensRepo.findActiveByHash.mockResolvedValue({
        userId: mockUser.user.id,
        sessionVersion: 3,
        rememberMe: true,
        expiresAt,
      });
      usersService.findByIdWithPermissions.mockResolvedValue(mockUser);
    });

    it('rota una sola vez, conserva el vencimiento absoluto y emite permisos actuales', async () => {
      const result = await service.refresh('old-refresh-token');

      expect(result.response).not.toHaveProperty('permissions');
      expect(result.response.access_token).toBe('access-token');
      expect(result.actorId).toBe(mockUser.user.id);
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.refreshExpiresAt).toBe(expiresAt);
      expect(refreshTokensRepo.rotate).toHaveBeenCalledWith(
        expect.stringMatching(/^[0-9a-f]{64}$/),
        expect.objectContaining({
          userId: mockUser.user.id,
          sessionVersion: 3,
          rememberMe: true,
          expiresAt,
        }),
        expect.any(Date),
      );
    });

    it('rechaza firma o payload de tipo incorrecto', async () => {
      jwtService.verify.mockReturnValue({ ...refreshPayload, tokenType: 'access' });
      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza token ausente, vencido o ya consumido en BD', async () => {
      refreshTokensRepo.findActiveByHash.mockResolvedValue(null);
      await expect(service.refresh('revoked-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza si la versión almacenada no coincide con el JWT', async () => {
      refreshTokensRepo.findActiveByHash.mockResolvedValue({
        userId: mockUser.user.id,
        sessionVersion: 4,
        rememberMe: false,
        expiresAt,
      });
      await expect(service.refresh('stale-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza usuario inactivo o cuya sesión fue invalidada', async () => {
      usersService.findByIdWithPermissions.mockResolvedValue({
        ...mockUser,
        user: { ...mockUser.user, sessionVersion: 4 },
      });
      await expect(service.refresh('stale-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza un replay si la rotación atómica no consume el hash', async () => {
      refreshTokensRepo.rotate.mockResolvedValue(false);
      await expect(service.refresh('replayed-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('validateAccessToken', () => {
    it('no confía en permisos del JWT y devuelve permisos actuales', async () => {
      usersService.findByIdWithPermissions.mockResolvedValue({
        ...mockUser,
        permissionKeys: ['patients.read'],
      });
      const result = await service.validateAccessToken({
        ...jwtPayload,
        permissions: ['admin.users.manage'],
      });
      expect(result.permissions).toEqual(['patients.read']);
    });

    it('revoca inmediatamente access tokens de otra versión', async () => {
      usersService.findByIdWithPermissions.mockResolvedValue({
        ...mockUser,
        user: { ...mockUser.user, sessionVersion: 4 },
      });
      await expect(service.validateAccessToken(jwtPayload)).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza un refresh token presentado como access token', async () => {
      await expect(service.validateAccessToken(refreshPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('elimina por hash sin persistir ni comparar el token en claro', async () => {
      await expect(service.logout('some-refresh-token')).resolves.toBe(mockUser.user.id);
      const deletedHash = refreshTokensRepo.deleteByHash.mock.calls[0][0];
      expect(deletedHash).not.toBe('some-refresh-token');
      expect(deletedHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('es idempotente sin cookie', async () => {
      await expect(service.logout(null)).resolves.toBeNull();
      expect(refreshTokensRepo.deleteByHash).not.toHaveBeenCalled();
    });
  });
});
