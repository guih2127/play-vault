import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard.js';

function makeCtx(ip = '1.1.1.1'): ExecutionContext {
  function handler() {}
  class Controller {}
  return {
    switchToHttp: () => ({ getRequest: () => ({ ip }) }),
    getHandler: () => handler,
    getClass: () => Controller,
  } as unknown as ExecutionContext;
}

function guardWith(opts: { limit: number; windowMs: number } | undefined): RateLimitGuard {
  const reflector = { getAllAndOverride: () => opts } as unknown as Reflector;
  return new RateLimitGuard(reflector);
}

describe('RateLimitGuard', () => {
  it('allows up to the limit then throws 429', () => {
    const guard = guardWith({ limit: 2, windowMs: 60_000 });
    const ctx = makeCtx();
    expect(guard.canActivate(ctx)).toBe(true);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(() => guard.canActivate(ctx)).toThrow(/too many requests/i);
  });

  it('is a no-op when the route has no rate-limit metadata', () => {
    const guard = guardWith(undefined);
    const ctx = makeCtx();
    for (let i = 0; i < 100; i++) expect(guard.canActivate(ctx)).toBe(true);
  });

  it('tracks each IP independently', () => {
    const guard = guardWith({ limit: 1, windowMs: 60_000 });
    expect(guard.canActivate(makeCtx('1.1.1.1'))).toBe(true);
    expect(guard.canActivate(makeCtx('2.2.2.2'))).toBe(true);
    expect(() => guard.canActivate(makeCtx('1.1.1.1'))).toThrow();
  });

  it('resets the window after it elapses', () => {
    vi.useFakeTimers();
    try {
      const guard = guardWith({ limit: 1, windowMs: 1_000 });
      const ctx = makeCtx();
      expect(guard.canActivate(ctx)).toBe(true);
      expect(() => guard.canActivate(ctx)).toThrow();
      vi.advanceTimersByTime(1_001);
      expect(guard.canActivate(ctx)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
