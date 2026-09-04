import { makeTestDb } from '../../test/helpers/db.js';

describe('DatabaseService users', () => {
  it('creates and looks up a password user by email and id', async () => {
    const db = await makeTestDb();
    const u = await db.createPasswordUser({ email: 'a@b.com', name: 'Ana', passwordHash: 'h' });
    expect((await db.getUserByEmail('a@b.com'))?.id).toBe(u.id);
    expect((await db.getUserById(u.id))?.email).toBe('a@b.com');
    await db.onModuleDestroy();
  });

  it('upserts a Google user by google_sub', async () => {
    const db = await makeTestDb();
    const first = await db.upsertUser({ googleSub: 'g1', email: 'old@x.com', name: 'Old' });
    const second = await db.upsertUser({ googleSub: 'g1', email: 'new@x.com', name: 'New' });
    expect(second.id).toBe(first.id);
    expect((await db.getUserById(first.id))?.email).toBe('new@x.com');
    await db.onModuleDestroy();
  });
});

describe('DatabaseService per-user isolation', () => {
  it('keeps every data table scoped to its user', async () => {
    const db = await makeTestDb();
    const u1 = await db.createPasswordUser({ email: 'u1@x.com', passwordHash: 'h' });
    const u2 = await db.createPasswordUser({ email: 'u2@x.com', passwordHash: 'h' });

    await db.setBeaten(u1.id, 'celeste', true);
    await db.setPlaying(u1.id, 'hades', true);
    await db.setRating(u1.id, 'celeste', 4);
    await db.addManualGame(u1.id, {
      title: 'Zelda',
      platform: 'Switch',
      playtimeMinutes: 600,
      coverUrl: null,
    });
    await db.addBacklogGame(u1.id, {
      title: 'HK',
      platform: 'PC',
      coverUrl: null,
      priority: 1,
      notes: null,
    });
    await db.upsertTitleTrophies(u1.id, 'NP1', '2024-01-01', [{ name: 't' }]);
    await db.saveSnapshot(u1.id, '2024-01-01', { providers: [], games: [] });

    // User 1 sees their data.
    expect((await db.getBeatenKeys(u1.id)).has('celeste')).toBe(true);
    expect((await db.getPlayingKeys(u1.id)).has('hades')).toBe(true);
    expect((await db.getRatings(u1.id)).get('celeste')).toBe(4);
    expect(await db.listManualGames(u1.id)).toHaveLength(1);
    expect(await db.listBacklogGames(u1.id)).toHaveLength(1);
    expect(await db.getAllStoredTrophies(u1.id)).toHaveLength(1);
    expect(await db.getLatestSnapshot(u1.id)).toBeTruthy();

    // User 2 sees nothing.
    expect((await db.getBeatenKeys(u2.id)).size).toBe(0);
    expect((await db.getPlayingKeys(u2.id)).size).toBe(0);
    expect((await db.getRatings(u2.id)).size).toBe(0);
    expect(await db.listManualGames(u2.id)).toHaveLength(0);
    expect(await db.listBacklogGames(u2.id)).toHaveLength(0);
    expect(await db.getAllStoredTrophies(u2.id)).toHaveLength(0);
    expect(await db.getLatestSnapshot(u2.id)).toBeNull();

    await db.onModuleDestroy();
  });

  it('deletes manual games only for the owning user', async () => {
    const db = await makeTestDb();
    const u1 = await db.createPasswordUser({ email: 'u1@x.com', passwordHash: 'h' });
    const u2 = await db.createPasswordUser({ email: 'u2@x.com', passwordHash: 'h' });
    const id1 = await db.addManualGame(u1.id, {
      title: 'A',
      platform: 'PC',
      playtimeMinutes: null,
      coverUrl: null,
    });
    // u2 cannot delete u1's row.
    await db.deleteManualGame(u2.id, id1);
    expect(await db.listManualGames(u1.id)).toHaveLength(1);
    await db.deleteManualGame(u1.id, id1);
    expect(await db.listManualGames(u1.id)).toHaveLength(0);
    await db.onModuleDestroy();
  });
});
