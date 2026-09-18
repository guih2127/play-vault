import { SyncService } from './sync.service.js';
import { makeTestDb } from '../../test/helpers/db.js';
import type { DatabaseService, DbUser } from '../db/database.service.js';
import type { GameProvider } from '../providers/game-provider.interface.js';
import type { NormalizedGame, Platform, ProviderResult } from '../domain/game.model.js';
import type { CryptoService } from '../auth/crypto.service.js';
import type { ConfigService } from '@nestjs/config';
import type { SnapshotPayload } from '../games/snapshot.js';

/** A provider whose per-call results are scripted, so we can drive success then failure. */
class FakeProvider implements GameProvider {
  private readonly queue: ProviderResult[];
  constructor(
    readonly platform: Platform,
    results: ProviderResult[],
    private readonly configured = true,
  ) {
    this.queue = results;
  }
  isConfigured(): boolean {
    return this.configured;
  }
  fetch(): Promise<ProviderResult> {
    return Promise.resolve(this.queue.shift() ?? { status: { provider: this.platform, connected: false }, games: [] });
  }
}

function game(over: Partial<NormalizedGame> = {}): NormalizedGame {
  return {
    provider: 'psn',
    externalId: 'np1',
    title: 'Celeste',
    platformLabel: 'PS5',
    playtimeMinutes: 300,
    playtimeKnown: true,
    trophySets: [
      { earned: 5, total: 10, progress: 50, platinumTotal: 1, platinumEarned: 0, platformLabel: 'PS5' },
    ],
    ...over,
  };
}

function ok(platform: Platform, games: NormalizedGame[], extra: Partial<ProviderResult> = {}): ProviderResult {
  return {
    status: { provider: platform, connected: true, gameCount: games.length, platinumEarned: 0 },
    games,
    ...extra,
  };
}

function fail(platform: Platform, error: string): ProviderResult {
  return { status: { provider: platform, connected: false, error }, games: [] };
}

function makeSync(db: DatabaseService, providers: GameProvider[]): SyncService {
  const crypto = { decrypt: (x: string) => x } as unknown as CryptoService;
  const config = { get: () => undefined } as unknown as ConfigService;
  return new SyncService(providers, db, crypto, config);
}

async function newUser(db: DatabaseService): Promise<DbUser> {
  return db.createPasswordUser({ email: 'u@x.com', passwordHash: 'h' });
}

describe('SyncService.sync', () => {
  it('preserves a failed provider’s games and trophy profile from the last snapshot', async () => {
    const db = await makeTestDb();
    const u = await newUser(db);
    const trophyProfile = { level: 100, tier: 1, progress: 50, counts: { bronze: 1, silver: 1, gold: 1, platinum: 1 } };
    const psn = new FakeProvider('psn', [
      ok('psn', [game()], { trophyProfile }),
      fail('psn', 'PSN service unavailable'),
    ]);
    const svc = makeSync(db, [psn]);

    await svc.sync(u.id);
    await svc.sync(u.id); // PSN fails on the second run

    const snap = await db.getLatestSnapshot<SnapshotPayload>(u.id);
    expect(snap?.data.games.map((g) => g.key)).toContain('celeste');
    expect(snap?.data.providers.find((p) => p.provider === 'psn')?.error).toBe(
      'PSN service unavailable',
    );
    // Last-known counts and the trophy profile survive the failed sync.
    expect(snap?.data.providers.find((p) => p.provider === 'psn')?.gameCount).toBe(1);
    expect(snap?.data.trophyProfile).toEqual(trophyProfile);
    await db.onModuleDestroy();
  });

  it('keeps a still-healthy provider’s fresh data when another provider fails', async () => {
    const db = await makeTestDb();
    const u = await newUser(db);
    const psn = new FakeProvider('psn', [
      ok('psn', [game()]),
      fail('psn', 'PSN down'),
    ]);
    const steam = new FakeProvider('steam', [
      ok('steam', [game({ provider: 'steam', title: 'Hades', platformLabel: 'Steam' })]),
      ok('steam', [game({ provider: 'steam', title: 'Hades', platformLabel: 'Steam', playtimeMinutes: 600 })]),
    ]);
    const svc = makeSync(db, [psn, steam]);

    await svc.sync(u.id);
    await svc.sync(u.id);

    const snap = await db.getLatestSnapshot<SnapshotPayload>(u.id);
    const keys = snap?.data.games.map((g) => g.key) ?? [];
    expect(keys).toContain('celeste'); // preserved from the failed PSN sync
    expect(keys).toContain('hades'); // fresh Steam data
    const hades = snap?.data.games.find((g) => g.key === 'hades');
    expect(hades?.totalPlaytimeMinutes).toBe(600); // took the fresh value, not the stale one
    await db.onModuleDestroy();
  });

  it('does not resurrect games when a provider is simply not configured', async () => {
    const db = await makeTestDb();
    const u = await newUser(db);
    // First sync has a game; second sync the provider reports "not configured" (configured=false).
    const psn = new FakeProvider(
      'psn',
      [ok('psn', [game()]), fail('psn', 'NPSSO not configured')],
      false,
    );
    const svc = makeSync(db, [psn]);

    await svc.sync(u.id);
    await svc.sync(u.id);

    const snap = await db.getLatestSnapshot<SnapshotPayload>(u.id);
    expect(snap?.data.games).toHaveLength(0);
    await db.onModuleDestroy();
  });
});
