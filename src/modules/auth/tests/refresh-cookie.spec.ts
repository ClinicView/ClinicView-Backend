import type { Request, Response } from 'express';
import {
  clearRefreshCookie,
  readRefreshCookie,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  setRefreshCookie,
} from '../refresh-cookie';

describe('refresh cookie', () => {
  it('lee solo la cookie canónica y decodifica su valor', () => {
    const request = {
      headers: { cookie: `foo=bar; ${REFRESH_COOKIE_NAME}=token%2Evalue` },
    } as Request;
    expect(readRefreshCookie(request)).toBe('token.value');
  });

  it('rechaza cookies ausentes, vacías o mal codificadas', () => {
    expect(readRefreshCookie({ headers: {} } as Request)).toBeNull();
    expect(
      readRefreshCookie({ headers: { cookie: `${REFRESH_COOKIE_NAME}=` } } as Request),
    ).toBeNull();
    expect(
      readRefreshCookie({ headers: { cookie: `${REFRESH_COOKIE_NAME}=%E0%A4%A` } } as Request),
    ).toBeNull();
  });

  it('rechaza dos cookies canónicas para evitar ambigüedad por cookie tossing', () => {
    expect(
      readRefreshCookie({
        headers: { cookie: `${REFRESH_COOKIE_NAME}=one; ${REFRESH_COOKIE_NAME}=two` },
      } as Request),
    ).toBeNull();
  });

  it('una sesión no persistente no emite Max-Age', () => {
    const response = { cookie: jest.fn() } as unknown as Response;
    setRefreshCookie(response, 'token', false, new Date(Date.now() + 10_000), 'development');
    expect(response.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE_NAME,
      'token',
      expect.not.objectContaining({ maxAge: expect.any(Number) }),
    );
  });

  it('rememberMe emite cookie persistente y Secure en producción', () => {
    const response = { cookie: jest.fn() } as unknown as Response;
    const now = Date.now();
    setRefreshCookie(response, 'token', true, new Date(now + 60_000), 'production', now);
    expect(response.cookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, 'token', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: 60_000,
    });
  });

  it('borra con los mismos atributos de alcance y seguridad', () => {
    const response = { clearCookie: jest.fn() } as unknown as Response;
    clearRefreshCookie(response, 'production');
    expect(response.clearCookie).toHaveBeenCalledWith(REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    });
  });
});
