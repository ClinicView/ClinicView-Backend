import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Request as RequestDecorator,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { AuthService, AuthSessionResult } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import {
  clearRefreshCookie,
  readRefreshCookie,
  REFRESH_COOKIE_NAME,
  setRefreshCookie,
} from './refresh-cookie';

const REFRESH_COOKIE_SECURITY_NAME = 'refresh-cookie';

type AuthenticatedRequest = { user: JwtPayload; headers?: Request['headers'] };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener la ficha del usuario autenticado' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 401, description: 'Access token inválido o revocado.' })
  me(@RequestDecorator() req: { user: JwtPayload }): Promise<UserResponseDto> {
    return this.usersService.findOne(req.user.sub);
  }

  @Post('login')
  @UseGuards(AuthGuard('local'))
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Iniciar sesión y establecer un refresh token HttpOnly' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    type: TokenResponseDto,
    headers: { 'Set-Cookie': { description: `${REFRESH_COOKIE_NAME} HttpOnly` } },
  })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas.' })
  async login(
    @RequestDecorator() req: AuthenticatedRequest,
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TokenResponseDto> {
    this.assertTrustedBrowserOrigin(req);
    const previousRefreshToken = readRefreshCookie({ headers: req.headers ?? {} });
    if (previousRefreshToken) await this.authService.logout(previousRefreshToken);
    const session = await this.authService.login(req.user, dto.rememberMe ?? false);
    this.writeSessionCookie(response, session);
    return session.response;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiCookieAuth(REFRESH_COOKIE_SECURITY_NAME)
  @ApiOperation({ summary: 'Rotar la cookie HttpOnly y renovar el access token' })
  @ApiResponse({
    status: 200,
    type: TokenResponseDto,
    headers: { 'Set-Cookie': { description: `${REFRESH_COOKIE_NAME} HttpOnly rotada` } },
  })
  @ApiResponse({ status: 401, description: 'Refresh token inválido, expirado o revocado.' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TokenResponseDto> {
    this.assertTrustedBrowserOrigin(request);
    const refreshToken = readRefreshCookie(request);
    if (!refreshToken) {
      this.clearSessionCookie(response);
      throw new UnauthorizedException('Refresh token requerido.');
    }

    try {
      const session = await this.authService.refresh(refreshToken);
      this.writeSessionCookie(response, session);
      return session.response;
    } catch (error) {
      this.clearSessionCookie(response);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCookieAuth(REFRESH_COOKIE_SECURITY_NAME)
  @ApiOperation({ summary: 'Revocar la sesión actual y borrar la cookie HttpOnly' })
  @ApiResponse({ status: 204, description: 'Sesión cerrada de forma idempotente.' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.assertTrustedBrowserOrigin(request);
    try {
      await this.authService.logout(readRefreshCookie(request));
    } finally {
      this.clearSessionCookie(response);
    }
  }

  private writeSessionCookie(response: Response, session: AuthSessionResult): void {
    this.disableCaching(response);
    setRefreshCookie(
      response,
      session.refreshToken,
      session.rememberMe,
      session.refreshExpiresAt,
      this.nodeEnv,
    );
  }

  private clearSessionCookie(response: Response): void {
    this.disableCaching(response);
    clearRefreshCookie(response, this.nodeEnv);
  }

  private disableCaching(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
  }

  private get nodeEnv(): string {
    return this.configService.get<string>('nodeEnv', 'development');
  }

  private assertTrustedBrowserOrigin(request: { headers?: Request['headers'] }): void {
    const origin = request.headers?.origin;
    if (!origin) return;
    const expected = this.configService
      .get<string>('frontendUrl', 'http://localhost:3000')
      .replace(/\/$/, '');
    if (origin.replace(/\/$/, '') !== expected) {
      throw new ForbiddenException('Origen no autorizado.');
    }
  }
}
