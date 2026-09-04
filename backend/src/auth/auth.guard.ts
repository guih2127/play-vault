import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import type { DbUser } from '../db/database.service.js';

export interface AuthedRequest extends Request {
  user: DbUser;
}

const SESSION_COOKIE = 'pv_session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { cookies?: Record<string, string> }>();
    const token = req.cookies?.[SESSION_COOKIE];
    const user = await this.auth.userFromToken(token);
    if (!user) throw new UnauthorizedException('Not authenticated');
    (req as AuthedRequest).user = user;
    return true;
  }
}
