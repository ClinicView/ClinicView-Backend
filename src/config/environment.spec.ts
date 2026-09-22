import { trustProxyHops, validateEnvironment } from './environment';

const valid = () => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://unit:synthetic@localhost:5433/unit_only',
  FRONTEND_URL: 'https://clinic.example.test',
  IA_INTERNAL_URL: 'http://ia:8000',
  JWT_SECRET: '1ab26d398f4075ecb4281f03e159cb47',
  JWT_REFRESH_SECRET: '2ab26d398f4075ecb4281f03e159cb47',
  AUDIT_HASH_SECRET: '3ab26d398f4075ecb4281f03e159cb47',
  IA_INTERNAL_API_KEY: '4ab26d398f4075ecb4281f03e159cb47',
});

describe('environment validation without secret disclosure', () => {
  it('keeps development and test defaults without requiring production secrets', () => {
    expect(validateEnvironment({})).toEqual({});
    expect(validateEnvironment({ NODE_ENV: 'test' })).toEqual({ NODE_ENV: 'test' });
  });
  it('accepts explicit independent production secrets and strips a trailing origin slash', () => {
    expect(
      validateEnvironment({ ...valid(), FRONTEND_URL: 'https://clinic.example.test/' }),
    ).toMatchObject({ FRONTEND_URL: 'https://clinic.example.test' });
  });
  it.each(['JWT_SECRET', 'JWT_REFRESH_SECRET', 'AUDIT_HASH_SECRET', 'IA_INTERNAL_API_KEY'])(
    'rejects missing/short/placeholder %s without echoing it',
    (name) => {
      for (const value of [
        undefined,
        'SENSITIVE',
        'x'.repeat(40),
        'change-me-this-is-a-placeholder-123456',
      ]) {
        expect(() => validateEnvironment({ ...valid(), [name]: value })).toThrow(name);
        try {
          validateEnvironment({ ...valid(), [name]: value });
        } catch (error) {
          expect((error as Error).message).not.toContain(String(value));
        }
      }
    },
  );
  it('rejects reused secrets', () => {
    expect(() =>
      validateEnvironment({ ...valid(), IA_INTERNAL_API_KEY: valid().JWT_SECRET }),
    ).toThrow('differ');
  });
  it('rejects control characters or whitespace that would invalidate internal HTTP authentication', () => {
    for (const value of [
      `${valid().IA_INTERNAL_API_KEY}\r\nInjected`,
      `${valid().JWT_SECRET} inner space`,
    ]) {
      expect(() => validateEnvironment({ ...valid(), IA_INTERNAL_API_KEY: value })).toThrow(
        'IA_INTERNAL_API_KEY',
      );
    }
  });
  it.each([
    ['FRONTEND_URL', 'http://clinic.example.test'],
    ['FRONTEND_URL', 'https://clinic.example.test/path'],
    ['FRONTEND_URL', 'https://user:SENSITIVE@clinic.example.test'],
    ['IA_INTERNAL_URL', undefined],
    ['IA_INTERNAL_URL', 'file:///private'],
    ['IA_INTERNAL_URL', 'http://ia:8000?key=SENSITIVE'],
    ['DATABASE_URL', 'sqlite:///private'],
    ['DATABASE_URL', undefined],
  ])('rejects invalid %s safely', (name, value) => {
    expect(() => validateEnvironment({ ...valid(), [name]: value })).toThrow(name);
    try {
      validateEnvironment({ ...valid(), [name]: value });
    } catch (error) {
      expect((error as Error).message).not.toContain('SENSITIVE');
    }
  });
  it('only trusts an explicit single proxy hop', () => {
    expect(trustProxyHops(undefined)).toBe(0);
    expect(trustProxyHops('0')).toBe(0);
    expect(trustProxyHops('1')).toBe(1);
    for (const value of ['true', '2', '-1', 'loopback', '1.0', ''])
      expect(() => trustProxyHops(value)).toThrow('TRUST_PROXY_HOPS');
  });
  it.each([
    { NODE_ENV: 'prod' },
    { READY_REQUIRE_IA: 'yes' },
    { HEALTH_TIMEOUT_MS: 'NaN' },
    { HEALTH_TIMEOUT_MS: '10001' },
    { HEALTH_TIMEOUT_MS: '1' },
  ])('rejects unsafe options %j', (env) => {
    expect(() => validateEnvironment(env)).toThrow('Invalid configuration');
  });
});
