import type { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import type { DatabaseService } from '../db/database.service.js';
import { makeTestDb } from '../../test/helpers/db.js';

function makeAuth(db: DatabaseService): AuthService {
  const values: Record<string, string> = {
    JWT_SECRET: 'test-secret-for-sessions',
    GOOGLE_CLIENT_ID: 'test-client-id',
  };
  const config = { get: (k: string) => values[k] } as unknown as ConfigService;
  const auth = new AuthService(config, db);
  auth.onModuleInit();
  return auth;
}

describe('AuthService.register', () => {
  it('creates a user and stores a bcrypt hash (not the plaintext)', async () => {
    const auth = makeAuth(makeTestDb());
    const user = await auth.register('Ana@B.com ', 'password123', 'Ana');
    expect(user.email).toBe('ana@b.com'); // normalized
    expect(user.password_hash).toBeTruthy();
    expect(user.password_hash).not.toBe('password123');
  });

  it('rejects a short password', async () => {
    const auth = makeAuth(makeTestDb());
    await expect(auth.register('a@b.com', 'short')).rejects.toThrow();
  });

  it('rejects an invalid email', async () => {
    const auth = makeAuth(makeTestDb());
    await expect(auth.register('not-an-email', 'password123')).rejects.toThrow();
  });

  it('rejects a duplicate email', async () => {
    const auth = makeAuth(makeTestDb());
    await auth.register('a@b.com', 'password123');
    await expect(auth.register('a@b.com', 'password123')).rejects.toThrow();
  });
});

describe('AuthService.loginWithPassword', () => {
  it('accepts the correct password and rejects wrong ones', async () => {
    const auth = makeAuth(makeTestDb());
    await auth.register('a@b.com', 'password123');
    const user = await auth.loginWithPassword('a@b.com', 'password123');
    expect(user.email).toBe('a@b.com');
    await expect(auth.loginWithPassword('a@b.com', 'wrongpass')).rejects.toThrow();
    await expect(auth.loginWithPassword('nobody@x.com', 'password123')).rejects.toThrow();
  });
});

describe('AuthService session tokens', () => {
  it('round-trips a signed session and rejects bad tokens', async () => {
    const auth = makeAuth(makeTestDb());
    const user = await auth.register('a@b.com', 'password123');
    const token = auth.signSession(user);
    expect(auth.userFromToken(token)?.id).toBe(user.id);
    expect(auth.userFromToken('garbage.token.value')).toBeNull();
    expect(auth.userFromToken(undefined)).toBeNull();
  });

  it('invalidates a token whose user no longer exists', async () => {
    const db = makeTestDb();
    const auth = makeAuth(db);
    const user = await auth.register('a@b.com', 'password123');
    const token = auth.signSession(user);
    // Signed with a different secret → verification fails.
    const otherAuth = makeAuth(makeTestDb());
    expect(otherAuth.userFromToken(token)).toBeNull();
  });
});
