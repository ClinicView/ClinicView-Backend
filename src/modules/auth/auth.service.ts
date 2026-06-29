import { createHash } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { HashingService } from '../../core/security/hashing.service';
import { UsersService } from '../users/users.service';
import { TokenResponseDto } from './dto/token-response.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
    const result = await this.usersService.findByEmailWithPermissions(email);
    if (!result || !result.user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    const isValid = await this.hashingService.compare(password, result.user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return { sub: result.user.id, email: result.user.email, permissions: result.permissionKeys };
  }

  async login(payload: JwtPayload): Promise<TokenResponseDto> {
    const expiresInSeconds = this.configService.get<number>('jwtRefresh.expiresInSeconds', 604800);

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(
      { sub: payload.sub, email: payload.email },
      {
        secret: this.configService.getOrThrow<string>('jwtRefresh.secret'),
        expiresIn: expiresInSeconds,
      },
    );

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    await this.refreshTokensRepo.deleteExpiredForUser(payload.sub);
    await this.refreshTokensRepo.store(payload.sub, hashToken(refreshToken), expiresAt);
    await this.usersService.updateLastLogin(payload.sub);

    return { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer' };
  }

  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    let payload: { sub: string; email: string };
    try {
      payload = this.jwtService.verify<{ sub: string; email: string }>(refreshToken, {
        secret: this.configService.getOrThrow<string>('jwtRefresh.secret'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado.');
    }

    const oldHash = hashToken(refreshToken);
    const stored = await this.refreshTokensRepo.findByHash(oldHash);
    if (!stored) {
      throw new UnauthorizedException('Refresh token revocado.');
    }

    const result = await this.usersService.findByEmailWithPermissions(payload.email);
    if (!result || !result.user.isActive) {
      throw new UnauthorizedException('Usuario no disponible.');
    }

    const expiresInSeconds = this.configService.get<number>('jwtRefresh.expiresInSeconds', 604800);
    const jwtPayload: JwtPayload = {
      sub: result.user.id,
      email: result.user.email,
      permissions: result.permissionKeys,
    };

    const newAccessToken = this.jwtService.sign(jwtPayload);
    const newRefreshToken = this.jwtService.sign(
      { sub: jwtPayload.sub, email: jwtPayload.email },
      {
        secret: this.configService.getOrThrow<string>('jwtRefresh.secret'),
        expiresIn: expiresInSeconds,
      },
    );

    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    await this.refreshTokensRepo.rotate(oldHash, result.user.id, hashToken(newRefreshToken), expiresAt);

    return { access_token: newAccessToken, refresh_token: newRefreshToken, token_type: 'Bearer' };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.refreshTokensRepo.deleteByHash(hashToken(refreshToken));
  }
}
