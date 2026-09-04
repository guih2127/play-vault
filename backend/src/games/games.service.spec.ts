import { GamesService } from './games.service.js';
import { makeTestDb } from '../../test/helpers/db.js';
import type { DatabaseService, DbUser } from '../db/database.service.js';
import type { AggregatedGame } from './aggregation.js';
import type { SnapshotPayload } from './snapshot.js';
import type { RecentTrophy } from '../domain/game.model.js';

function aggGame(over: Partial<AggregatedGame> = {}): AggregatedGame {
  return {
    key: 'celeste',
    title: 'Celeste',
    platformLabels: ['PS5'],
    providers: ['psn'],
    totalPlaytimeMinutes: 300,
    playtimeKnown: true,
    genres: ['Platformer'],
    lastPlayed: '2024-05-01',
    trophySets: [
      { label: 'PS5', platformLabel: 'PS5', earned: 5, total: 10, progress: 50, platinumEarned: 0, platinumTotal: 1 },
    ],
    platinum: { earned: 0, total: 1 },
    ...over,
  };
}

async function seedLibrary(
  db: DatabaseService,
  userId: number,
  games: AggregatedGame[] = [aggGame()],
): Promise<void> {
  const payload: SnapshotPayload = {
    providers: [{ provider: 'psn', connected: true, platinumEarned: 0 }],
    games,
  };
  await db.saveSnapshot(userId, '2024-05-01T00:00:00Z', payload);
}

async function setup(): Promise<{ db: DatabaseService; svc: GamesService; u1: DbUser; u2: DbUser }> {
  const db = await makeTestDb();
  const svc = new GamesService([], db);
  const u1 = await db.createPasswordUser({ email: 'u1@x.com', passwordHash: 'h' });
  const u2 = await db.createPasswordUser({ email: 'u2@x.com', passwordHash: 'h' });
  return { db, svc, u1, u2 };
}

describe('GamesService.getGames', () => {
  it('returns synced games with beaten/playing/rating applied', async () => {
    const { db, svc, u1 } = await setup();
    await seedLibrary(db, u1.id);
    await db.setBeaten(u1.id, 'celeste', true);
    await db.setRating(u1.id, 'celeste', 4);

    const games = await svc.getGames(u1.id);
    expect(games).toHaveLength(1);
    expect(games[0].beaten).toBe(true);
    expect(games[0].rating).toBe(4);
    await db.onModuleDestroy();
  });

  it('drops synced games that have no trophy sets but keeps manual games', async () => {
    const { db, svc, u1 } = await setup();
    await seedLibrary(db, u1.id, [
      aggGame(),
      aggGame({ key: 'notrophies', title: 'NoTrophies', trophySets: [] }),
    ]);
    await svc.addManualGame(u1.id, { title: 'Zelda', platform: 'Switch' });

    const keys = (await svc.getGames(u1.id)).map((g) => g.key);
    expect(keys).toContain('celeste');
    expect(keys).not.toContain('notrophies');
    expect(keys.some((k) => k.startsWith('manual:'))).toBe(true);
    await db.onModuleDestroy();
  });
});

describe('GamesService.getDashboard', () => {
  it('aggregates totals and counts', async () => {
    const { db, svc, u1 } = await setup();
    await seedLibrary(db, u1.id);
    await db.setBeaten(u1.id, 'celeste', true);

    const dash = await svc.getDashboard(u1.id);
    expect(dash.totals.games).toBe(1);
    expect(dash.totals.trophiesEarned).toBe(5);
    expect(dash.counts.beaten).toBe(1);
    expect(dash.providers.map((p) => p.provider)).toContain('psn');
    await db.onModuleDestroy();
  });
});

describe('GamesService manual games and backlog', () => {
  it('adds and deletes a manual game', async () => {
    const { db, svc, u1 } = await setup();
    const { id } = await svc.addManualGame(u1.id, { title: 'Zelda', platform: 'Switch', hours: 10 });
    expect((await svc.getGames(u1.id)).some((g) => g.key === `manual:${id}`)).toBe(true);
    await svc.deleteManualGame(u1.id, id);
    expect((await svc.getGames(u1.id)).some((g) => g.key === `manual:${id}`)).toBe(false);
    await db.onModuleDestroy();
  });

  it('updates the hours of a manual game and clears them with 0', async () => {
    const { db, svc, u1 } = await setup();
    const { id } = await svc.addManualGame(u1.id, {
      title: 'Zelda',
      platform: 'Nintendo Switch 2',
      hours: 10,
    });
    const key = `manual:${id}`;
    const minutes = async () => (await svc.getGames(u1.id)).find((x) => x.key === key)!.totalPlaytimeMinutes;

    expect(await minutes()).toBe(600);
    expect(await svc.updateManualGameHours(u1.id, id, 25)).toBe(true);
    expect(await minutes()).toBe(1500);

    // 0 clears the playtime.
    expect(await svc.updateManualGameHours(u1.id, id, 0)).toBe(true);
    const g = (await svc.getGames(u1.id)).find((x) => x.key === key)!;
    expect(g.totalPlaytimeMinutes).toBe(0);
    expect(g.playtimeKnown).toBe(false);
    await db.onModuleDestroy();
  });

  it('does not update a manual game belonging to another user or a missing id', async () => {
    const { db, svc, u1, u2 } = await setup();
    const { id } = await svc.addManualGame(u1.id, {
      title: 'Zelda',
      platform: 'Nintendo Switch 2',
      hours: 10,
    });
    expect(await svc.updateManualGameHours(u2.id, id, 50)).toBe(false);
    expect(await svc.updateManualGameHours(u1.id, 99999, 50)).toBe(false);
    expect((await svc.getGames(u1.id)).find((x) => x.key === `manual:${id}`)!.totalPlaytimeMinutes).toBe(600);
    await db.onModuleDestroy();
  });

  it('starts a backlog item into the library as a playing manual game', async () => {
    const { db, svc, u1 } = await setup();
    const { id } = await svc.addBacklogGame(u1.id, { title: 'Hollow Knight', platform: 'PC', priority: 2 });
    expect(await svc.getBacklog(u1.id)).toHaveLength(1);

    const started = await svc.startBacklogGame(u1.id, id);
    expect(started).toBeTruthy();
    expect(await svc.getBacklog(u1.id)).toHaveLength(0);
    const manual = (await svc.getGames(u1.id)).find((g) => g.key === `manual:${started!.id}`);
    expect(manual?.playing).toBe(true);
    await db.onModuleDestroy();
  });
});

describe('GamesService per-user isolation', () => {
  it('never leaks one user library into another', async () => {
    const { db, svc, u1, u2 } = await setup();
    await seedLibrary(db, u1.id);
    await svc.addManualGame(u1.id, { title: 'Zelda', platform: 'Switch' });
    await svc.addBacklogGame(u1.id, { title: 'HK', platform: 'PC' });

    expect(await svc.getGames(u2.id)).toHaveLength(0);
    expect(await svc.getBacklog(u2.id)).toHaveLength(0);
    expect((await svc.getDashboard(u2.id)).totals.games).toBe(0);
    await db.onModuleDestroy();
  });
});

describe('GamesService dashboard preloading optimization', () => {
  it('produces identical games whether or not snapshot/trophies are preloaded', async () => {
    const { db, svc, u1 } = await setup();
    await seedLibrary(db, u1.id);
    await db.setBeaten(u1.id, 'celeste', true);

    const snap = await db.getLatestSnapshot<SnapshotPayload>(u1.id);
    const trophies = await db.getAllStoredTrophies<RecentTrophy>(u1.id);
    expect(await svc.getGames(u1.id, snap, trophies)).toEqual(await svc.getGames(u1.id));
    await db.onModuleDestroy();
  });
});
