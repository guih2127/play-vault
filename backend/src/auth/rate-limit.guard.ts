import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_KEY = 'rate_limit';

/**
 * Limit a route to `limit` requests per `windowMs` per client IP. Applied to auth endpoints to
 * blunt password brute-forcing. Requires `trust proxy` to be set so `req.ip` is the real client.
 */
export const RateLimit = (limit: number, windowMs: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowMs } satisfies RateLimitOptions);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!opts) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const key = `${req.ip}:${ctx.getClass().name}.${ctx.getHandler().name}`;
    const now = Date.now();

    const entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      this.prune(now);
      this.hits.set(key, { count: 1, resetAt: now + opts.windowMs });
      return true;
    }
    if (entry.count >= opts.limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw new HttpException(
        `Too many requests. Try again in ${retryAfter}s.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    entry.count += 1;
    return true;
  }

  /** Drop expired windows so the map doesn't grow unbounded with unique IPs. */
  private prune(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [k, v] of this.hits) {
      if (now >= v.resetAt) this.hits.delete(k);
    }
  }
}
