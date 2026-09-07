import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { AuthGuard, type AuthedRequest } from './auth.guard.js';
import { RateLimit, RateLimitGuard } from './rate-limit.guard.js';
import { GoogleDto, LoginDto, RegisterDto } from './auth.dto.js';
import type { DbUser } from '../db/database.service.js';

const SESSION_COOKIE = 'pv_session';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Sets the same-origin session cookie (used by the web app) and returns the raw JWT so native
   *  clients (mobile), which can't use the cookie, can store it and send it as a Bearer token. */
  private setSession(res: Response, user: DbUser): string {
    const token = this.auth.signSession(user);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      // Only send over HTTPS in production; kept off in dev so http://localhost works.
      secure: process.env.NODE_ENV === 'production',
      maxAge: this.auth.cookieMaxAge,
      path: '/',
    });
    return token;
  }

  @Post('google')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60_000)
  async google(@Body() body: GoogleDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.loginWithGoogle(body.credential ?? '');
    const token = this.setSession(res, user);
    return { ...this.auth.toPublic(user), token };
  }

  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60_000)
  async register(@Body() body: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(body.email ?? '', body.password ?? '', body.name);
    const token = this.setSession(res, user);
    return { ...this.auth.toPublic(user), token };
  }

  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60_000)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.loginWithPassword(body.email ?? '', body.password ?? '');
    const token = this.setSession(res, user);
    return { ...this.auth.toPublic(user), token };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest) {
    return this.auth.toPublic(req.user);
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }
}
