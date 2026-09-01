import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { AuthGuard, type AuthedRequest } from './auth.guard.js';
import { GoogleDto, LoginDto, RegisterDto } from './auth.dto.js';
import type { DbUser } from '../db/database.service.js';

const SESSION_COOKIE = 'pv_session';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setSession(res: Response, user: DbUser) {
    const token = this.auth.signSession(user);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: this.auth.cookieMaxAge,
      path: '/',
    });
  }

  @Post('google')
  async google(@Body() body: GoogleDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.loginWithGoogle(body.credential ?? '');
    this.setSession(res, user);
    return this.auth.toPublic(user);
  }

  @Post('register')
  async register(@Body() body: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.register(body.email ?? '', body.password ?? '', body.name);
    this.setSession(res, user);
    return this.auth.toPublic(user);
  }

  @Post('login')
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.auth.loginWithPassword(body.email ?? '', body.password ?? '');
    this.setSession(res, user);
    return this.auth.toPublic(user);
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
