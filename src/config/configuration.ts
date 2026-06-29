/** Convierte strings tipo '1d', '15m', '7d' a segundos (número). */
function durationToSeconds(value: string): number {
  const match = /^(\d+)(ms|s|m|h|d|w)$/.exec(value);
  if (!match) return 86400;
  const n = parseInt(match[1], 10);
  const unit = match[2];
  const factor: Record<string, number> = {
    ms: 0.001, s: 1, m: 60, h: 3600, d: 86400, w: 604800,
  };
  return Math.round(n * factor[unit]);
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  database: {
    url: process.env.DATABASE_URL,
  },
  ia: {
    internalUrl: process.env.IA_INTERNAL_URL ?? 'http://ia:8000',
  },
  storage: {
    uploadDir: process.env.UPLOAD_DIR ?? './uploads',
    maxFileSizeBytes: parseInt(process.env.UPLOAD_MAX_SIZE_MB ?? '20', 10) * 1024 * 1024,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresInSeconds: durationToSeconds(process.env.JWT_EXPIRES_IN ?? '1d'),
  },
  jwtRefresh: {
    secret: process.env.JWT_REFRESH_SECRET,
    expiresInSeconds: durationToSeconds(process.env.JWT_REFRESH_EXPIRES_IN ?? '7d'),
  },
});
