import { createHash, randomUUID } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { HashingService } from '../../core/security/hashing.service';
import { UsersService, UserWithPermissionKeys } from '../users/users.service';
import { TokenResponseDto } from './dto/token-response.dto';
import { JwtPayload, RefreshJwtPayload } from './interfaces/jwt-payload.interface';
import {
  RefreshTokensRepository,
  RefreshTokenWrite,
} from './repositories/refresh-tokens.repository';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRefreshJwtPayload(value: unknown): value is RefreshJwtPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RefreshJwtPayload>;
  return (
    typeof candidate.sub === 'string' &&
    candidate.sub.length > 0 &&
    isVersion(candidate.sessionVersion) &&
    candidate.tokenType === 'refresh' &&
    typeof candidate.jti === 'string' &&
    candidate.jti.length > 0
  );
}

function isAccessJwtPayload(value: unknown): value is JwtPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<JwtPayload>;
  return (
    typeof candidate.sub === 'string' &&
    candidate.sub.length > 0 &&
    typeof candidate.email === 'string' &&
    Array.isArray(candidate.permissions) &&
    isVersion(candidate.sessionVersion) &&
    candidate.tokenType === 'access'
  );
}

export interface AuthSessionResult {
  actorId: string;
  response: TokenResponseDto;
  refreshToken: string;
  rememberMe: boolean;
  refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly hashingService: HashingService,
    private readonly refreshTokensRepo: RefreshTokensRepository,
  ) {}

  async validateUser(email: string, password: string): Promise<JwtPayload> {
    const result = await this.usersService.findByEmailWithPermissions(email.trim().toLowerCase());
    if (!result || !result.user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const isValid = await this.hashingService.compare(password, result.user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return this.toAccessPayload(result);
  }

  async login(payload: JwtPayload, rememberMe = false): Promise<AuthSessionResult> {
    if (!isAccessJwtPayload(payload)) {
      throw new UnauthorizedException('Usuario no disponible.');
    }

    const now = new Date();
    const refreshTtlSeconds = this.getRefreshTtlSeconds(rememberMe);
    const refreshExpiresAt = new Date(now.getTime() + refreshTtlSeconds * 1000);
    const refresh = this.signRefreshToken(payload.sub, payload.sessionVersion, refreshTtlSeconds);
    const response = this.signAccessToken(payload);
    const stored = await this.refreshTokensRepo.createSession(
      this.toRefreshTokenWrite(payload, refresh, rememberMe, refreshExpiresAt),
      now,
    );
    if (!stored) {
      throw new UnauthorizedException('Usuario no disponible.');
    }

    return {
      actorId: payload.sub,
      response,
      refreshToken: refresh.token,
      rememberMe,
      refreshExpiresAt,
    };
  }

  async refresh(refreshToken: string): Promise<AuthSessionResult> {
    const payload = this.verifyRefreshToken(refreshToken);
    const now = new Date();
    const oldHash = hashToken(refreshToken);
    const stored = await this.refreshTokensRepo.findActiveByHash(oldHash, now);
    if (
      !stored ||
      stored.userId !== payload.sub ||
      stored.sessionVersion !== payload.sessionVersion
    ) {
      throw new UnauthorizedException('Refresh token inválido, expirado o revocado.');
    }

    const current = await this.usersService.findByIdWithPermissions(stored.userId);
    if (
      !current?.user.isActive ||
      current.user.sessionVersion !== stored.sessionVersion
    ) {
      throw new UnauthorizedException('Usuario no disponible.');
    }

    const remainingSeconds = Math.max(
      1,
      Math.ceil((stored.expiresAt.getTime() - now.getTime()) / 1000),
    );
    const accessPayload = this.toAccessPayload(current);
    const nextRefresh = this.signRefreshToken(
      current.user.id,
      current.user.sessionVersion,
      remainingSeconds,
    );
    const response = this.signAccessToken(accessPayload);
    const rotated = await this.refreshTokensRepo.rotate(
      oldHash,
      this.toRefreshTokenWrite(
        accessPayload,
        nextRefresh,
        stored.rememberMe,
        stored.expiresAt,
      ),
      now,
    );
    if (!rotated) {
      throw new UnauthorizedException('Refresh token inválido, expirado o revocado.');
    }

    return {
      actorId: current.user.id,
      response,
      refreshToken: nextRefresh.token,
      rememberMe: stored.rememberMe,
      refreshExpiresAt: stored.expiresAt,
    };
  }

  async logout(refreshToken: string | null): Promise<string | null> {
    if (!refreshToken) return null;
    return this.refreshTokensRepo.deleteByHash(hashToken(refreshToken));
  }

  async validateAccessToken(payload: unknown): Promise<JwtPayload> {
    if (!isAccessJwtPayload(payload)) {
      throw new UnauthorizedException('Access token inválido.');
    }

    const current = await this.usersService.findByIdWithPermissions(payload.sub);
    if (
      !current?.user.isActive ||
      current.user.sessionVersion !== payload.sessionVersion
    ) {
      throw new UnauthorizedException('Access token revocado.');
    }

    return this.toAccessPayload(current);
  }

  private verifyRefreshToken(refreshToken: string): RefreshJwtPayload {
    try {
      const payload = this.jwtService.verify<Record<string, unknown>>(refreshToken, {
        secret: this.configService.getOrThrow<string>('jwtRefresh.secret'),
      });
      if (!isRefreshJwtPayload(payload)) throw new Error('Invalid refresh payload');
      return payload;
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }
  }

  private signAccessToken(payload: JwtPayload): TokenResponseDto {
    const expiresIn = this.configService.get<number>('jwt.expiresInSeconds', 15 * 60);
    return {
      access_token: this.jwtService.sign(payload, { expiresIn }),
      token_type: 'Bearer',
      expires_in: expiresIn,
    };
  }

  private signRefreshToken(
    userId: string,
    sessionVersion: number,
    expiresIn: number,
  ): { id: string; token: string } {
    const id = randomUUID();
    const payload: RefreshJwtPayload = {
      sub: userId,
      sessionVersion,
      tokenType: 'refresh',
      jti: id,
    };
    return {
      id,
      token: this.jwtService.sign(payload, {
        secret: this.configService.getOrThrow<string>('jwtRefresh.secret'),
        expiresIn,
      }),
    };
  }

  private toRefreshTokenWrite(
    payload: JwtPayload,
    refresh: { id: string; token: string },
    rememberMe: boolean,
    expiresAt: Date,
  ): RefreshTokenWrite {
    return {
      id: refresh.id,
      userId: payload.sub,
      tokenHash: hashToken(refresh.token),
      sessionVersion: payload.sessionVersion,
      rememberMe,
      expiresAt,
    };
  }

  private toAccessPayload(result: UserWithPermissionKeys): JwtPayload {
    return {
      sub: result.user.id,
      email: result.user.email,
      permissions: [...new Set(result.permissionKeys)],
      sessionVersion: result.user.sessionVersion,
      tokenType: 'access',
    };
  }

  private getRefreshTtlSeconds(rememberMe: boolean): number {
    return rememberMe
      ? this.configService.get<number>('jwtRefresh.expiresInSeconds', 7 * 24 * 60 * 60)
      : this.configService.get<number>('jwtRefresh.sessionExpiresInSeconds', 24 * 60 * 60);
  }
}
