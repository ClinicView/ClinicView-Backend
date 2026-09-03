import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { JwtStrategy } from '../strategies/jwt.strategy';

describe('JwtStrategy', () => {
  it('delega cada request en la validación de estado/permisos actuales', async () => {
    const payload: JwtPayload = {
      sub: 'f9b3308d-cc74-4f30-823a-75ca624ff69f',
      email: 'user@hospital.org',
      permissions: ['stale.permission'],
      sessionVersion: 1,
      tokenType: 'access',
    };
    const current = { ...payload, permissions: ['patients.read'] };
    const authService = {
      validateAccessToken: jest.fn().mockResolvedValue(current),
    };
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('access-secret-with-at-least-32-characters'),
    };
    const strategy = new JwtStrategy(
      configService as unknown as ConfigService,
      authService as unknown as AuthService,
    );

    await expect(strategy.validate(payload)).resolves.toEqual(current);
    expect(authService.validateAccessToken).toHaveBeenCalledWith(payload);
  });
});
