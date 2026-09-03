import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';
import { RequestContextService } from '../../../core/request-context/request-context.service';
import { UsersService } from '../../users/users.service';
import { AuthController } from '../auth.controller';
import { AuthService, AuthSessionResult } from '../auth.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../refresh-cookie';

const jwtPayload: JwtPayload = {
  sub: 'f9b3308d-cc74-4f30-823a-75ca624ff69f',
  email: 'medico@hospital.org',
  permissions: ['patients.read'],
  sessionVersion: 2,
  tokenType: 'access',
};

const session: AuthSessionResult = {
  actorId: jwtPayload.sub,
  response: { access_token: 'access-token', token_type: 'Bearer', expires_in: 900 },
  refreshToken: 'refresh-token',
  rememberMe: false,
  refreshExpiresAt: new Date(Date.now() + 86_400_000),
};

const userResponse = {
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
  roles: [],
};

describe('AuthController', () => {
  let controller: AuthController;
  let authService: { login: jest.Mock; refresh: jest.Mock; logout: jest.Mock };
  let usersService: { findOne: jest.Mock };
  let requestContext: { setActor: jest.Mock };
  let response: Pick<Response, 'cookie' | 'clearCookie' | 'setHeader'>;

  beforeEach(async () => {
    authService = {
      login: jest.fn().mockResolvedValue(session),
      refresh: jest.fn().mockResolvedValue(session),
      logout: jest.fn().mockResolvedValue(jwtPayload.sub),
    };
    usersService = { findOne: jest.fn().mockResolvedValue(userResponse) };
    requestContext = { setActor: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: UsersService, useValue: usersService },
        { provide: RequestContextService, useValue: requestContext },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback: unknown) => {
              if (key === 'nodeEnv') return 'development';
              if (key === 'frontendUrl') return 'http://localhost:3000';
              return fallback;
            }),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AuthController);
    response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      setHeader: jest.fn(),
    };
  });

  it('login devuelve solo access token y establece cookie HttpOnly de sesión', async () => {
    const result = await controller.login(
      { user: jwtPayload },
      { email: jwtPayload.email, password: 'password123', rememberMe: false },
      response as Response,
    );

    expect(authService.login).toHaveBeenCalledWith(jwtPayload, false);
    expect(result).toEqual(session.response);
    expect(result).not.toHaveProperty('refresh_token');
    expect(response.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      session.refreshToken,
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
      }),
    );
    expect((response.cookie as jest.Mock).mock.calls[0][2]).not.toHaveProperty('maxAge');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(requestContext.setActor).toHaveBeenCalledWith(jwtPayload.sub);
  });

  it('refresh toma exclusivamente la cookie y la rota', async () => {
    const request = {
      headers: { cookie: `otra=1; ${REFRESH_COOKIE_NAME}=old-refresh` },
    } as Request;
    const result = await controller.refresh(request, response as Response);

    expect(authService.refresh).toHaveBeenCalledWith('old-refresh');
    expect(result).toEqual(session.response);
    expect(requestContext.setActor).toHaveBeenCalledWith(jwtPayload.sub);
    expect(response.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      session.refreshToken,
      expect.any(Object),
    );
  });

  it('login revoca la cookie previa antes de crear la nueva sesión', async () => {
    await controller.login(
      {
        user: jwtPayload,
        headers: { cookie: `${REFRESH_COOKIE_NAME}=previous-refresh` },
      },
      { email: jwtPayload.email, password: 'password123', rememberMe: true },
      response as Response,
    );

    expect(authService.logout).toHaveBeenCalledWith('previous-refresh');
    expect(authService.login).toHaveBeenCalledWith(jwtPayload, true);
    expect(authService.logout.mock.invocationCallOrder[0]).toBeLessThan(
      authService.login.mock.invocationCallOrder[0],
    );
  });

  it('rechaza mutaciones de cookie enviadas desde otro origen web', async () => {
    await expect(
      controller.logout(
        { headers: { origin: 'https://sitio-malicioso.example' } } as Request,
        response as Response,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(authService.logout).not.toHaveBeenCalled();
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('refresh sin cookie responde 401 y elimina cualquier cookie residual', async () => {
    await expect(
      controller.refresh({ headers: {} } as Request, response as Response),
    ).rejects.toThrow(UnauthorizedException);
    expect(authService.refresh).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      expect.objectContaining({ path: REFRESH_COOKIE_PATH }),
    );
  });

  it('refresh inválido limpia la cookie antes de propagar el error', async () => {
    authService.refresh.mockRejectedValue(new UnauthorizedException());
    await expect(
      controller.refresh(
        { headers: { cookie: `${REFRESH_COOKIE_NAME}=invalid` } } as Request,
        response as Response,
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(response.clearCookie).toHaveBeenCalled();
  });

  it('logout revoca si hay cookie y siempre la borra', async () => {
    await controller.logout(
      { headers: { cookie: `${REFRESH_COOKIE_NAME}=active-refresh` } } as Request,
      response as Response,
    );
    expect(authService.logout).toHaveBeenCalledWith('active-refresh');
    expect(requestContext.setActor).toHaveBeenCalledWith(jwtPayload.sub);
    expect(response.clearCookie).toHaveBeenCalled();
  });

  it('logout es idempotente aunque no haya cookie', async () => {
    authService.logout.mockResolvedValue(null);
    await controller.logout({ headers: {} } as Request, response as Response);
    expect(authService.logout).toHaveBeenCalledWith(null);
    expect(response.clearCookie).toHaveBeenCalled();
    expect(requestContext.setActor).toHaveBeenCalledWith(null);
  });

  it('me devuelve la ficha del usuario autenticado', async () => {
    await expect(controller.me({ user: jwtPayload })).resolves.toEqual(userResponse);
    expect(usersService.findOne).toHaveBeenCalledWith(jwtPayload.sub);
  });
});
