export interface JwtPayload {
  sub: string;
  email: string;
  username: string;
  permissions: string[];
  sessionVersion: number;
  tokenType: 'access';
}

export interface RefreshJwtPayload {
  sub: string;
  sessionVersion: number;
  tokenType: 'refresh';
  jti: string;
}
