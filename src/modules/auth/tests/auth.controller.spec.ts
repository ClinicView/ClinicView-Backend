import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { TokenResponseDto } from '../dto/token-response.dto';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UsersService } from '../../users/users.service';

const mockTokenResponse: TokenResponseDto = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  token_type: 'Bearer',
};

const jwtPayload: JwtPayload = {
  sub: 'uuid-user-001',
  email: 'medico@hospital.org',
  permissions: ['patients.read'],
};

const mockAuthService = {
  login: jest.fn().mockResolvedValue(mockTokenResponse),
  refresh: jest.fn().mockResolvedValue(mockTokenResponse),
  logout: jest.fn().mockResolvedValue(undefined),
} satisfies Record<'login' | 'refresh' | 'logout', jest.Mock>;

const mockUserResponse = {
  id: jwtPayload.sub,
  email: jwtPayload.email,
  username: 'medico',
  firstName: 'Dr.',
  lastName: 'Ejemplo',
  fullName: 'Dr. Ejemplo',
  documentType: null,
  documentNumber: null,
  profession: 'Médico',
  isActive: true,
  lastLoginAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  roles: [{ key: 'MEDICO', name: 'Médico' }],
};

const mockUsersService = {
  findOne: jest.fn().mockResolvedValue(mockUserResponse),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: UsersService, useValue: mockUsersService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AuthController);
    jest.clearAllMocks();
  });

  it('login delega en AuthService con el payload del usuario', async () => {
    mockAuthService.login.mockResolvedValue(mockTokenResponse);
    const result = await controller.login({ user: jwtPayload });

    expect(mockAuthService.login).toHaveBeenCalledWith(jwtPayload);
    expect(result.access_token).toBe('access-token');
    expect(result.refresh_token).toBe('refresh-token');
    expect(result.token_type).toBe('Bearer');
  });

  it('refresh delega en AuthService con el refresh_token del body', async () => {
    mockAuthService.refresh.mockResolvedValue(mockTokenResponse);
    const result = await controller.refresh({ refresh_token: 'valid-refresh-token' });

    expect(mockAuthService.refresh).toHaveBeenCalledWith('valid-refresh-token');
    expect(result.access_token).toBe('access-token');
  });

  it('logout delega en AuthService con el refresh_token del body', async () => {
    mockAuthService.logout.mockResolvedValue(undefined);
    await controller.logout({ refresh_token: 'some-refresh-token' });

    expect(mockAuthService.logout).toHaveBeenCalledWith('some-refresh-token');
  });

  it('me devuelve la ficha del usuario autenticado', async () => {
    const result = await controller.me({ user: jwtPayload });

    expect(mockUsersService.findOne).toHaveBeenCalledWith(jwtPayload.sub);
    expect(result).toEqual(mockUserResponse);
  });
});
