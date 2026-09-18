import { SyncService } from './sync.service.js';
import { makeTestDb } from '../../test/helpers/db.js';
import type { DatabaseService, DbUser } from '../db/database.service.js';
import type { GameProvider } from '../providers/game-provider.interface.js';
import type { NormalizedGame, Platform, ProviderResult } from '../domain/game.model.js';
import type { CryptoService } from '../auth/crypto.service.js';
import type { ConfigService } from '@nestjs/config';

/** A provider that always returns the given synced games. */
class StaticProvider implements GameProvider {
  constructor(
    readonly platform: Platform,
    private readonly games: NormalizedGame[],
  ) {}
  isConfigured(): boolean {
    return true;
  }
  fetch(): Promise<ProviderResult> {
    return Promise.resolve({
      status: { provider: this.platform, connected: true, gameCount: this.games.length },
      games: this.games,
    });
  }
}

function game(title: string, over: Partial<NormalizedGame> = {}): NormalizedGame {
  return {
    provider: 'psn',
    externalId: title,
    title,
    platformLabel: 'PS5',
    playtimeMinutes: 600,
    playtimeKnown: true,
    trophySets: [
      { earned: 3, total: 10, progress: 30, platinumTotal: 1, platinumEarned: 0, platformLabel: 'PS5' },
    ],
    ...over,
  };
}

function makeSync(db: DatabaseService, games: NormalizedGame[]): SyncService {
  const crypto = { decrypt: (x: string) => x } as unknown as CryptoService;
  const config = { get: () => undefined } as unknown as ConfigService;
  return new SyncService([new StaticProvider('psn', games)], db, crypto, config);
}

async function newUser(db: DatabaseService): Promise<DbUser> {
  return db.createPasswordUser({ email: 'u@x.com', passwordHash: 'h' });
}

describe('SyncService reconciliation with the manual library', () => {
  it('moves a backlog game to currently playing when it shows up in a sync', async () => {
    const db = await makeTestDb();
    const u = await newUser(db);
    await db.addBacklogGame(u.id, {
      title: 'Elden Ring',
      platform: 'PS5',
      coverUrl: null,
      priority: 1,
      notes: null,
    });
    const svc = makeSync(db, [game('Elden Ring')]);

    await svc.sync(u.id);

    expect(await db.listBacklogGames(u.id)).toHaveLength(0);
    expect(await db.getPlayingKeys(u.id)).toContain('elden ring');
    await db.onModuleDestroy();
  });

  it('folds a manual "playing" game into its synced copy, carrying the flag over', async () => {
    const db = await makeTestDb();
    const u = await newUser(db);
    const manualId = await db.addManualGame(u.id, {
      title: 'Hades',
      platform: 'PS5',
      playtimeMinutes: 120,
      coverUrl: null,
    });
    await db.setPlaying(u.id, `manual:${manualId}`, true);
    const svc = makeSync(db, [game('Hades', { playtimeMinutes: 900 })]);

    await svc.sync(u.id);

    // Manual duplicate gone; playing flag now lives on the synced key.
    expect(await db.listManualGames(u.id)).toHaveLength(0);
    const playing = await db.getPlayingKeys(u.id);
    expect(playing).toContain('hades');
    expect(playing).not.toContain(`manual:${manualId}`);
    await db.onModuleDestroy();
  });

  it('carries a manual beaten flag over to the synced copy', async () => {
    const db = await makeTestDb();
    const u = await newUser(db);
    const manualId = await db.addManualGame(u.id, {
      title: 'Celeste',
      platform: 'PS5',
      playtimeMinutes: 60,
      coverUrl: null,
    });
    await db.setBeaten(u.id, `manual:${manualId}`, true);
    const svc = makeSync(db, [game('Celeste')]);

    await svc.sync(u.id);

    expect(await db.listManualGames(u.id)).toHaveLength(0);
    expect(await db.getBeatenKeys(u.id)).toContain('celeste');
    await db.onModuleDestroy();
  });

  it('leaves manual/backlog games that are not in the sync untouched', async () => {
    const db = await makeTestDb();
    const u = await newUser(db);
    await db.addManualGame(u.id, {
      title: 'Some Switch Game',
      platform: 'Switch',
      playtimeMinutes: 300,
      coverUrl: null,
    });
    await db.addBacklogGame(u.id, {
      title: 'Backlog Only',
      platform: 'PC',
      coverUrl: null,
      priority: 1,
      notes: null,
    });
    const svc = makeSync(db, [game('Unrelated Synced Game')]);

    await svc.sync(u.id);

    expect(await db.listManualGames(u.id)).toHaveLength(1);
    expect(await db.listBacklogGames(u.id)).toHaveLength(1);
    await db.onModuleDestroy();
  });
});
