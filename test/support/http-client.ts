export interface JsonHttpResult<T> {
  response: Response;
  body: T;
}

export async function jsonRequest<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<JsonHttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'User-Agent': 'ClinicView-E2E-UA-SENTINEL-91A7',
      ...init.headers,
    },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : (undefined as T);
  return { response, body };
}

export function jsonHeaders(accessToken?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Origin: 'http://localhost:3000',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

export function cookieFrom(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error('La respuesta no incluyó Set-Cookie.');
  const pair = setCookie.split(';', 1)[0];
  if (!pair.startsWith('clinicview_refresh_token=')) {
    throw new Error('La respuesta no incluyó la cookie de refresh esperada.');
  }
  return pair;
}
