type Environment = Record<string, unknown>;

/** Never include environment values in startup errors (URLs may contain credentials). */
function invalid(name: string, requirement: string): never {
  throw new Error(`Invalid configuration: ${name} ${requirement}.`);
}

export function trustProxyHops(value: unknown): 0 | 1 {
  if (value === undefined || value === '0') return 0;
  if (value === '1') return 1;
  return invalid('TRUST_PROXY_HOPS', 'must be 0 or 1');
}

function origin(value: unknown, name: string, protocols: string[]): string {
  if (typeof value !== 'string' || !value.trim()) return invalid(name, 'is required');
  try {
    const url = new URL(value);
    if (
      !protocols.includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/'
    )
      throw new Error();
    return url.origin;
  } catch {
    return invalid(name, 'must be an explicit origin without credentials, path, query or fragment');
  }
}

export function validateEnvironment(input: Environment): Environment {
  const env = { ...input };
  if (
    env.NODE_ENV !== undefined &&
    !['development', 'test', 'production'].includes(String(env.NODE_ENV))
  )
    invalid('NODE_ENV', 'must be development, test or production');
  trustProxyHops(env.TRUST_PROXY_HOPS);
  if (
    env.READY_REQUIRE_IA !== undefined &&
    !['true', 'false'].includes(String(env.READY_REQUIRE_IA))
  )
    invalid('READY_REQUIRE_IA', 'must be true or false');
  if (
    env.HEALTH_TIMEOUT_MS !== undefined &&
    (typeof env.HEALTH_TIMEOUT_MS !== 'string' ||
      !/^\d+$/.test(env.HEALTH_TIMEOUT_MS) ||
      Number(env.HEALTH_TIMEOUT_MS) < 250 ||
      Number(env.HEALTH_TIMEOUT_MS) > 10000)
  )
    invalid('HEALTH_TIMEOUT_MS', 'must be an integer from 250 to 10000');
  if (env.NODE_ENV !== 'production') return env;

  const names = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'AUDIT_HASH_SECRET', 'IA_INTERNAL_API_KEY'];
  const seen = new Set<string>();
  for (const name of names) {
    const value = env[name];
    if (
      typeof value !== 'string' ||
      value.length < 32 ||
      value.length > 4096 ||
      value !== value.trim() ||
      /[^\x21-\x7e]/.test(value) ||
      new Set(value).size < 8 ||
      /change[ _-]?me|placeholder|example|development|replace[ _-]?me|your[ _-]?secret/i.test(value)
    )
      invalid(name, 'must be a non-placeholder secret of at least 32 characters');
    if (seen.has(value)) invalid(name, 'must differ from every other application secret');
    seen.add(value);
  }
  env.FRONTEND_URL = origin(env.FRONTEND_URL, 'FRONTEND_URL', ['https:']);
  env.IA_INTERNAL_URL = origin(env.IA_INTERNAL_URL, 'IA_INTERNAL_URL', ['http:', 'https:']);
  try {
    const database = new URL(String(env.DATABASE_URL ?? ''));
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !database.hostname ||
      database.pathname.length < 2
    )
      throw new Error();
  } catch {
    invalid('DATABASE_URL', 'must be an explicit PostgreSQL connection URL');
  }
  return env;
}
