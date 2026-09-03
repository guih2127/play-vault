import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseService } from './database.service.js';
import { makeTestDb } from '../../test/helpers/db.js';

describe('DatabaseService users', () => {
  it('creates and looks up a password user by email and id', () => {
    const db = makeTestDb();
    const u = db.createPasswordUser({ email: 'a@b.com', name: 'Ana', passwordHash: 'h' });
    expect(db.getUserByEmail('a@b.com')?.id).toBe(u.id);
    expect(db.getUserById(u.id)?.email).toBe('a@b.com');
    db.onModuleDestroy();
  });

  it('upserts a Google user by google_sub', () => {
    const db = makeTestDb();
    const first = db.upsertUser({ googleSub: 'g1', email: 'old@x.com', name: 'Old' });
    const second = db.upsertUser({ googleSub: 'g1', email: 'new@x.com', name: 'New' });
    expect(second.id).toBe(first.id);
    expect(db.getUserById(first.id)?.email).toBe('new@x.com');
    db.onModuleDestroy();
  });
});

describe('DatabaseService per-user isolation', () => {
  it('keeps every data table scoped to its user', () => {
    const db = makeTestDb();
    const u1 = db.createPasswordUser({ email: 'u1@x.com', passwordHash: 'h' });
    const u2 = db.createPasswordUser({ email: 'u2@x.com', passwordHash: 'h' });

    db.setBeaten(u1.id, 'celeste', true);
    db.setPlaying(u1.id, 'hades', true);
    db.setRating(u1.id, 'celeste', 4);
    db.addManualGame(u1.id, { title: 'Zelda', platform: 'Switch', playtimeMinutes: 600, coverUrl: null });
    db.addBacklogGame(u1.id, { title: 'HK', platform: 'PC', coverUrl: null, priority: 1, notes: null });
    db.upsertTitleTrophies(u1.id, 'NP1', '2024-01-01', [{ name: 't' }]);
    db.saveSnapshot(u1.id, '2024-01-01', { providers: [], games: [] });

    // User 1 sees their data.
    expect(db.getBeatenKeys(u1.id).has('celeste')).toBe(true);
    expect(db.getPlayingKeys(u1.id).has('hades')).toBe(true);
    expect(db.getRatings(u1.id).get('celeste')).toBe(4);
    expect(db.listManualGames(u1.id)).toHaveLength(1);
    expect(db.listBacklogGames(u1.id)).toHaveLength(1);
    expect(db.getAllStoredTrophies(u1.id)).toHaveLength(1);
    expect(db.getLatestSnapshot(u1.id)).toBeTruthy();

    // User 2 sees nothing.
    expect(db.getBeatenKeys(u2.id).size).toBe(0);
    expect(db.getPlayingKeys(u2.id).size).toBe(0);
    expect(db.getRatings(u2.id).size).toBe(0);
    expect(db.listManualGames(u2.id)).toHaveLength(0);
    expect(db.listBacklogGames(u2.id)).toHaveLength(0);
    expect(db.getAllStoredTrophies(u2.id)).toHaveLength(0);
    expect(db.getLatestSnapshot(u2.id)).toBeNull();

    db.onModuleDestroy();
  });

  it('deletes manual games and backlog only for the owning user', () => {
    const db = makeTestDb();
    const u1 = db.createPasswordUser({ email: 'u1@x.com', passwordHash: 'h' });
    const u2 = db.createPasswordUser({ email: 'u2@x.com', passwordHash: 'h' });
    const id1 = db.addManualGame(u1.id, { title: 'A', platform: 'PC', playtimeMinutes: null, coverUrl: null });
    // u2 cannot delete u1's row.
    db.deleteManualGame(u2.id, id1);
    expect(db.listManualGames(u1.id)).toHaveLength(1);
    db.deleteManualGame(u1.id, id1);
    expect(db.listManualGames(u1.id)).toHaveLength(0);
    db.onModuleDestroy();
  });
});

describe('DatabaseService migration from pre-user-scoping schema', () => {
  it('assigns existing global rows to the owner (lowest user id)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pv-mig-'));
    const file = join(dir, 'legacy.db');

    // Build an OLD-schema database: users plus globally-keyed game data (no user_id).
    const seed = new DatabaseSync(file);
    seed.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, google_sub TEXT UNIQUE, email TEXT, name TEXT,
        picture TEXT, password_hash TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE game_flags (game_key TEXT PRIMARY KEY, beaten INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE snapshot (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, data TEXT NOT NULL);
    `);
    seed
      .prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
      .run('owner@x.com', 'h', '2024-01-01');
    seed.prepare('INSERT INTO game_flags (game_key, beaten, updated_at) VALUES (?, 1, ?)').run('celeste', '2024-01-02');
    seed
      .prepare('INSERT INTO snapshot (created_at, data) VALUES (?, ?)')
      .run('2024-01-03', JSON.stringify({ providers: [], games: [] }));
    seed.close();

    // Point a real DatabaseService at the legacy file; migration runs on init.
    process.env.DATABASE_PATH = file;
    const db = new DatabaseService();
    db.onModuleInit();
    try {
      const owner = db.getUserByEmail('owner@x.com')!;
      expect(owner).toBeTruthy();
      expect(db.getBeatenKeys(owner.id).has('celeste')).toBe(true);
      expect(db.getLatestSnapshot(owner.id)).toBeTruthy();
      // Nobody else inherits the data.
      expect(db.getBeatenKeys(owner.id + 999).size).toBe(0);
    } finally {
      db.onModuleDestroy();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
