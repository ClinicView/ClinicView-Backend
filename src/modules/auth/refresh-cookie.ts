import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE_NAME = 'clinicview_refresh_token';
export const REFRESH_COOKIE_PATH = '/api/auth';

function baseCookieOptions(nodeEnv: string): CookieOptions {
  return {
    httpOnly: true,
    secure: nodeEnv === 'production',
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  };
}

export function readRefreshCookie(request: Pick<Request, 'headers'>): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;

  let token: string | null = null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== REFRESH_COOKIE_NAME) continue;

    // Una cookie duplicada es ambigua (cookie tossing); se rechaza completa.
    if (token !== null) return null;

    const rawValue = part.slice(separator + 1).trim();
    if (!rawValue) return null;
    try {
      token = decodeURIComponent(rawValue);
    } catch {
      return null;
    }
  }
  return token;
}

export function setRefreshCookie(
  response: Pick<Response, 'cookie'>,
  token: string,
  rememberMe: boolean,
  expiresAt: Date,
  nodeEnv: string,
  now = Date.now(),
): void {
  const options = baseCookieOptions(nodeEnv);
  if (rememberMe) {
    options.maxAge = Math.max(0, expiresAt.getTime() - now);
  }
  response.cookie(REFRESH_COOKIE_NAME, token, options);
}

export function clearRefreshCookie(
  response: Pick<Response, 'clearCookie'>,
  nodeEnv: string,
): void {
  response.clearCookie(REFRESH_COOKIE_NAME, baseCookieOptions(nodeEnv));
}
