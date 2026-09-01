import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export interface StoredSnapshot<T> {
  id: number;
  createdAt: string;
  data: T;
}

export interface DbUser {
  id: number;
  google_sub: string | null;
  email: string | null;
  name: string | null;
  picture: string | null;
  password_hash: string | null;
  created_at: string;
}

export interface DbConnections {
  user_id: number;
  psn_npsso: string | null;
  steam_id: string | null;
  updated_at: string;
}

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);
  private db!: DatabaseSync;

  onModuleInit(): void {
    const path = join(process.cwd(), 'playvault.db');
    const legacy = join(process.cwd(), 'gametracker.db');
    if (!existsSync(path) && existsSync(legacy)) renameSync(legacy, path);
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshot (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_flags (
        game_key TEXT PRIMARY KEY,
        beaten INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_playing (
        game_key TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_meta (
        game_key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS manual_game (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        platform TEXT NOT NULL,
        playtime_minutes INTEGER,
        cover_url TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_rating (
        game_key TEXT PRIMARY KEY,
        rating INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS backlog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        platform TEXT NOT NULL,
        cover_url TEXT,
        priority INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS title_trophies (
        np_comm_id TEXT PRIMARY KEY,
        last_updated TEXT,
        data TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_sub TEXT UNIQUE,
        email TEXT,
        name TEXT,
        picture TEXT,
        password_hash TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_connections (
        user_id INTEGER PRIMARY KEY,
        psn_npsso TEXT,
        steam_id TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    this.migrateUsersTable();
    this.migrateConnectionsTable();
    this.logger.log(`SQLite database ready at ${path}`);
  }

  private migrateConnectionsTable(): void {
    const cols = this.db.prepare('PRAGMA table_info(user_connections)').all() as Array<{
      name: string;
    }>;
    if (cols.length && !cols.some((c) => c.name === 'psn_npsso')) {
      this.db.exec('ALTER TABLE user_connections ADD COLUMN psn_npsso TEXT');
    }
  }

  private migrateUsersTable(): void {
    const cols = this.db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    if (!cols.length || cols.some((c) => c.name === 'password_hash')) return;
    this.db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        google_sub TEXT UNIQUE,
        email TEXT,
        name TEXT,
        picture TEXT,
        password_hash TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO users_new (id, google_sub, email, name, picture, created_at)
        SELECT id, google_sub, email, name, picture, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  }

  upsertUser(u: { googleSub: string; email?: string; name?: string; picture?: string }): DbUser {
    this.db
      .prepare(
        `INSERT INTO users (google_sub, email, name, picture, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(google_sub) DO UPDATE SET
           email = excluded.email, name = excluded.name, picture = excluded.picture`,
      )
      .run(
        u.googleSub,
        u.email ?? null,
        u.name ?? null,
        u.picture ?? null,
        new Date().toISOString(),
      );
    return this.db
      .prepare('SELECT * FROM users WHERE google_sub = ?')
      .get(u.googleSub) as unknown as DbUser;
  }

  getUserById(id: number): DbUser | null {
    return (
      (this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as DbUser) ?? null
    );
  }

  getUserByEmail(email: string): DbUser | null {
    return (
      (this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as DbUser) ??
      null
    );
  }

  createPasswordUser(u: { email: string; name?: string; passwordHash: string }): DbUser {
    const info = this.db
      .prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(u.email, u.name ?? null, u.passwordHash, new Date().toISOString());
    return this.getUserById(Number(info.lastInsertRowid))!;
  }

  getConnections(userId: number): DbConnections | null {
    return (
      (this.db
        .prepare('SELECT * FROM user_connections WHERE user_id = ?')
        .get(userId) as unknown as DbConnections) ?? null
    );
  }

  setPsnNpsso(userId: number, npsso: string | null): void {
    this.db
      .prepare(
        `INSERT INTO user_connections (user_id, psn_npsso, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET psn_npsso = excluded.psn_npsso, updated_at = excluded.updated_at`,
      )
      .run(userId, npsso, new Date().toISOString());
  }

  setSteamId(userId: number, steamId: string | null): void {
    this.db
      .prepare(
        `INSERT INTO user_connections (user_id, steam_id, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET steam_id = excluded.steam_id, updated_at = excluded.updated_at`,
      )
      .run(userId, steamId, new Date().toISOString());
  }

  setBeaten(gameKey: string, beaten: boolean): void {
    this.db
      .prepare(
        `INSERT INTO game_flags (game_key, beaten, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(game_key) DO UPDATE SET beaten = excluded.beaten, updated_at = excluded.updated_at`,
      )
      .run(gameKey, beaten ? 1 : 0, new Date().toISOString());
  }

  getBeatenKeys(): Set<string> {
    const rows = this.db
      .prepare('SELECT game_key FROM game_flags WHERE beaten = 1')
      .all() as Array<{ game_key: string }>;
    return new Set(rows.map((r) => r.game_key));
  }

  setBeatenDate(gameKey: string, date: string): void {
    this.db
      .prepare(
        `INSERT INTO game_flags (game_key, beaten, updated_at) VALUES (?, 1, ?)
         ON CONFLICT(game_key) DO UPDATE SET beaten = 1, updated_at = excluded.updated_at`,
      )
      .run(gameKey, date);
  }

  getBeatenDates(): Map<string, string> {
    const rows = this.db
      .prepare('SELECT game_key, updated_at FROM game_flags WHERE beaten = 1')
      .all() as Array<{ game_key: string; updated_at: string }>;
    return new Map(rows.map((r) => [r.game_key, r.updated_at]));
  }

  setPlaying(gameKey: string, playing: boolean): void {
    if (!playing) {
      this.db.prepare('DELETE FROM game_playing WHERE game_key = ?').run(gameKey);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO game_playing (game_key, updated_at) VALUES (?, ?)
         ON CONFLICT(game_key) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(gameKey, new Date().toISOString());
  }

  getPlayingKeys(): Set<string> {
    const rows = this.db.prepare('SELECT game_key FROM game_playing').all() as Array<{
      game_key: string;
    }>;
    return new Set(rows.map((r) => r.game_key));
  }

  addManualGame(game: {
    title: string;
    platform: string;
    playtimeMinutes: number | null;
    coverUrl: string | null;
  }): number {
    const info = this.db
      .prepare(
        'INSERT INTO manual_game (title, platform, playtime_minutes, cover_url, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        game.title,
        game.platform,
        game.playtimeMinutes,
        game.coverUrl,
        new Date().toISOString(),
      );
    return Number(info.lastInsertRowid);
  }

  listManualGames(): Array<{
    id: number;
    title: string;
    platform: string;
    playtime_minutes: number | null;
    cover_url: string | null;
  }> {
    return this.db
      .prepare(
        'SELECT id, title, platform, playtime_minutes, cover_url FROM manual_game ORDER BY id DESC',
      )
      .all() as Array<{
      id: number;
      title: string;
      platform: string;
      playtime_minutes: number | null;
      cover_url: string | null;
    }>;
  }

  deleteManualGame(id: number): void {
    this.db.prepare('DELETE FROM manual_game WHERE id = ?').run(id);
  }

  addBacklogGame(game: {
    title: string;
    platform: string;
    coverUrl: string | null;
    priority: number;
    notes: string | null;
  }): number {
    const info = this.db
      .prepare(
        'INSERT INTO backlog (title, platform, cover_url, priority, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        game.title,
        game.platform,
        game.coverUrl,
        game.priority,
        game.notes,
        new Date().toISOString(),
      );
    return Number(info.lastInsertRowid);
  }

  listBacklogGames(): Array<{
    id: number;
    title: string;
    platform: string;
    cover_url: string | null;
    priority: number;
    notes: string | null;
    created_at: string;
  }> {
    return this.db
      .prepare(
        'SELECT id, title, platform, cover_url, priority, notes, created_at FROM backlog ORDER BY priority DESC, id DESC',
      )
      .all() as Array<{
      id: number;
      title: string;
      platform: string;
      cover_url: string | null;
      priority: number;
      notes: string | null;
      created_at: string;
    }>;
  }

  getBacklogGame(id: number):
    | {
        id: number;
        title: string;
        platform: string;
        cover_url: string | null;
        priority: number;
        notes: string | null;
        created_at: string;
      }
    | undefined {
    return this.db
      .prepare(
        'SELECT id, title, platform, cover_url, priority, notes, created_at FROM backlog WHERE id = ?',
      )
      .get(id) as
      | {
          id: number;
          title: string;
          platform: string;
          cover_url: string | null;
          priority: number;
          notes: string | null;
          created_at: string;
        }
      | undefined;
  }

  setBacklogPriority(id: number, priority: number): void {
    this.db.prepare('UPDATE backlog SET priority = ? WHERE id = ?').run(priority, id);
  }

  deleteBacklogGame(id: number): void {
    this.db.prepare('DELETE FROM backlog WHERE id = ?').run(id);
  }

  setMeta(gameKey: string, data: unknown): void {
    this.db
      .prepare(
        `INSERT INTO game_meta (game_key, data, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(game_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
      )
      .run(gameKey, JSON.stringify(data), new Date().toISOString());
  }

  setRating(gameKey: string, rating: number): void {
    if (!rating) {
      this.db.prepare('DELETE FROM game_rating WHERE game_key = ?').run(gameKey);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO game_rating (game_key, rating, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(game_key) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
      )
      .run(gameKey, rating, new Date().toISOString());
  }

  getRatings(): Map<string, number> {
    const rows = this.db.prepare('SELECT game_key, rating FROM game_rating').all() as Array<{
      game_key: string;
      rating: number;
    }>;
    return new Map(rows.map((r) => [r.game_key, r.rating]));
  }

  getMeta<T>(gameKey: string): T | null {
    const row = this.db.prepare('SELECT data FROM game_meta WHERE game_key = ?').get(gameKey) as
      { data: string } | undefined;
    return row ? (JSON.parse(row.data) as T) : null;
  }

  saveSnapshot(createdAt: string, data: unknown): void {
    this.db
      .prepare('INSERT INTO snapshot (created_at, data) VALUES (?, ?)')
      .run(createdAt, JSON.stringify(data));
  }

  /** Map of title id -> lastUpdatedDateTime already stored, for incremental sync diffing. */
  getTrophyTitleState(): Map<string, string> {
    const rows = this.db
      .prepare('SELECT np_comm_id, last_updated FROM title_trophies')
      .all() as Array<{ np_comm_id: string; last_updated: string | null }>;
    return new Map(rows.map((r) => [r.np_comm_id, r.last_updated ?? '']));
  }

  upsertTitleTrophies(npCommId: string, lastUpdated: string | undefined, trophies: unknown): void {
    this.db
      .prepare(
        `INSERT INTO title_trophies (np_comm_id, last_updated, data, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(np_comm_id) DO UPDATE SET last_updated = excluded.last_updated, data = excluded.data, fetched_at = excluded.fetched_at`,
      )
      .run(npCommId, lastUpdated ?? null, JSON.stringify(trophies), new Date().toISOString());
  }

  getAllStoredTrophies<T>(): T[] {
    const rows = this.db.prepare('SELECT data FROM title_trophies').all() as Array<{
      data: string;
    }>;
    const out: T[] = [];
    for (const r of rows) {
      try {
        const arr = JSON.parse(r.data) as T[];
        if (Array.isArray(arr)) out.push(...arr);
      } catch {
        // skip malformed rows
      }
    }
    return out;
  }

  getLatestSnapshot<T>(): StoredSnapshot<T> | null {
    const row = this.db
      .prepare('SELECT id, created_at, data FROM snapshot ORDER BY id DESC LIMIT 1')
      .get() as { id: number; created_at: string; data: string } | undefined;
    if (!row) return null;
    return { id: row.id, createdAt: row.created_at, data: JSON.parse(row.data) as T };
  }
}
