import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginDto } from '../dto/login.dto';

describe('LoginDto', () => {
  it('acepta rememberMe booleano opcional', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'user@hospital.org',
      password: 'password123',
      rememberMe: true,
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('no convierte strings truthy en persistencia de sesión', async () => {
    const dto = plainToInstance(LoginDto, {
      email: 'user@hospital.org',
      password: 'password123',
      rememberMe: 'true',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'rememberMe')).toBe(true);
  });
});
