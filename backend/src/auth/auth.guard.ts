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
    const token = tokenFromRequest(req);
    const user = await this.auth.userFromToken(token);
    if (!user) throw new UnauthorizedException('Not authenticated');
    (req as AuthedRequest).user = user;
    return true;
  }
}

/** The web app authenticates with the same-origin `pv_session` cookie; native clients (mobile)
 *  can't use it, so they send the same JWT as an `Authorization: Bearer <token>` header. Prefer
 *  the cookie when both are present. */
function tokenFromRequest(
  req: Request & { cookies?: Record<string, string> },
): string | undefined {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) return cookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return undefined;
}
