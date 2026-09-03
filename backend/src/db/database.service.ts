import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private db!: DatabaseSync;

  onModuleInit(): void {
    // In production point DATABASE_PATH at a persistent volume (e.g. /data/playvault.db) so the
    // database survives redeploys. Defaults to ./playvault.db for local development.
    const path = process.env.DATABASE_PATH?.trim() || join(process.cwd(), 'playvault.db');
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const legacy = join(process.cwd(), 'gametracker.db');
    if (!existsSync(path) && existsSync(legacy)) renameSync(legacy, path);
    this.db = new DatabaseSync(path);
    this.db.exec(`
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
      CREATE TABLE IF NOT EXISTS snapshot (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_flags (
        user_id INTEGER NOT NULL,
        game_key TEXT NOT NULL,
        beaten INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, game_key)
      );
      CREATE TABLE IF NOT EXISTS game_playing (
        user_id INTEGER NOT NULL,
        game_key TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, game_key)
      );
      CREATE TABLE IF NOT EXISTS game_meta (
        game_key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS manual_game (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        platform TEXT NOT NULL,
        playtime_minutes INTEGER,
        cover_url TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_rating (
        user_id INTEGER NOT NULL,
        game_key TEXT NOT NULL,
        rating INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, game_key)
      );
      CREATE TABLE IF NOT EXISTS backlog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        platform TEXT NOT NULL,
        cover_url TEXT,
        priority INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS title_trophies (
        user_id INTEGER NOT NULL,
        np_comm_id TEXT NOT NULL,
        last_updated TEXT,
        data TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY (user_id, np_comm_id)
      );
    `);
    this.migrateUsersTable();
    this.migrateConnectionsTable();
    this.migratePerUserData();
    this.ensureIndexes();
    this.logger.log(`SQLite database ready at ${path}`);
  }

  onModuleDestroy(): void {
    this.db?.close();
  }

  /**
   * Indexes for the lookups that aren't already served by a primary key. Runs after the per-user
   * migration so the user_id columns exist. The *_key/np_comm_id tables are already covered by
   * their composite PK (user_id is the leftmost column), so they need nothing extra.
   */
  private ensureIndexes(): void {
    this.db.exec(`
      -- Login/register look users up by email (not the PK).
      CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
      -- getLatestSnapshot filters by user_id and takes the newest (highest id).
      CREATE INDEX IF NOT EXISTS idx_snapshot_user ON snapshot (user_id, id);
      -- Per-user listings of the id-keyed tables.
      CREATE INDEX IF NOT EXISTS idx_manual_user ON manual_game (user_id);
      CREATE INDEX IF NOT EXISTS idx_backlog_user ON backlog (user_id);
    `);
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

  /** The account that pre-user-scoping global data belongs to (the single existing owner). */
  private ownerId(): number | null {
    const row = this.db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as
      | { id: number }
      | undefined;
    return row?.id ?? null;
  }

  /**
   * Back when there was no login, all game/trophy data was global. Now every data table is
   * scoped by user_id. For tables keyed by an autoincrement id we just add the column and
   * backfill it; for tables whose primary key must become composite we rebuild them.
   */
  private migratePerUserData(): void {
    const owner = this.ownerId();
    this.migrateAddUserIdColumn('snapshot', owner);
    this.migrateAddUserIdColumn('manual_game', owner);
    this.migrateAddUserIdColumn('backlog', owner);
    this.rebuildWithUserId(
      'game_flags',
      `user_id INTEGER NOT NULL, game_key TEXT NOT NULL, beaten INTEGER NOT NULL DEFAULT 0,
       updated_at TEXT NOT NULL, PRIMARY KEY (user_id, game_key)`,
      'game_key, beaten, updated_at',
      owner,
    );
    this.rebuildWithUserId(
      'game_playing',
      `user_id INTEGER NOT NULL, game_key TEXT NOT NULL, updated_at TEXT NOT NULL,
       PRIMARY KEY (user_id, game_key)`,
      'game_key, updated_at',
      owner,
    );
    this.rebuildWithUserId(
      'game_rating',
      `user_id INTEGER NOT NULL, game_key TEXT NOT NULL, rating INTEGER NOT NULL,
       updated_at TEXT NOT NULL, PRIMARY KEY (user_id, game_key)`,
      'game_key, rating, updated_at',
      owner,
    );
    this.rebuildWithUserId(
      'title_trophies',
      `user_id INTEGER NOT NULL, np_comm_id TEXT NOT NULL, last_updated TEXT, data TEXT NOT NULL,
       fetched_at TEXT NOT NULL, PRIMARY KEY (user_id, np_comm_id)`,
      'np_comm_id, last_updated, data, fetched_at',
      owner,
    );
  }

  private hasUserId(table: string): boolean {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return cols.some((c) => c.name === 'user_id');
  }

  private migrateAddUserIdColumn(table: string, owner: number | null): void {
    if (this.hasUserId(table)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN user_id INTEGER`);
    if (owner != null) {
      this.db.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id IS NULL`).run(owner);
    }
    this.logger.log(`Migrated ${table} to per-user (owner=${owner ?? 'none'})`);
  }

  private rebuildWithUserId(
    table: string,
    newColumnsDdl: string,
    copyColumns: string,
    owner: number | null,
  ): void {
    if (this.hasUserId(table)) return;
    this.db.exec(`CREATE TABLE ${table}_new (${newColumnsDdl});`);
    if (owner != null) {
      this.db
        .prepare(
          `INSERT INTO ${table}_new (user_id, ${copyColumns}) SELECT ?, ${copyColumns} FROM ${table}`,
        )
        .run(owner);
    }
    this.db.exec(`DROP TABLE ${table}; ALTER TABLE ${table}_new RENAME TO ${table};`);
    this.logger.log(`Rebuilt ${table} as per-user (owner=${owner ?? 'none'})`);
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

  setBeaten(userId: number, gameKey: string, beaten: boolean): void {
    this.db
      .prepare(
        `INSERT INTO game_flags (user_id, game_key, beaten, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, game_key) DO UPDATE SET beaten = excluded.beaten, updated_at = excluded.updated_at`,
      )
      .run(userId, gameKey, beaten ? 1 : 0, new Date().toISOString());
  }

  getBeatenKeys(userId: number): Set<string> {
    const rows = this.db
      .prepare('SELECT game_key FROM game_flags WHERE user_id = ? AND beaten = 1')
      .all(userId) as Array<{ game_key: string }>;
    return new Set(rows.map((r) => r.game_key));
  }

  setBeatenDate(userId: number, gameKey: string, date: string): void {
    this.db
      .prepare(
        `INSERT INTO game_flags (user_id, game_key, beaten, updated_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(user_id, game_key) DO UPDATE SET beaten = 1, updated_at = excluded.updated_at`,
      )
      .run(userId, gameKey, date);
  }

  getBeatenDates(userId: number): Map<string, string> {
    const rows = this.db
      .prepare('SELECT game_key, updated_at FROM game_flags WHERE user_id = ? AND beaten = 1')
      .all(userId) as Array<{ game_key: string; updated_at: string }>;
    return new Map(rows.map((r) => [r.game_key, r.updated_at]));
  }

  setPlaying(userId: number, gameKey: string, playing: boolean): void {
    if (!playing) {
      this.db
        .prepare('DELETE FROM game_playing WHERE user_id = ? AND game_key = ?')
        .run(userId, gameKey);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO game_playing (user_id, game_key, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id, game_key) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(userId, gameKey, new Date().toISOString());
  }

  getPlayingKeys(userId: number): Set<string> {
    const rows = this.db
      .prepare('SELECT game_key FROM game_playing WHERE user_id = ?')
      .all(userId) as Array<{ game_key: string }>;
    return new Set(rows.map((r) => r.game_key));
  }

  addManualGame(
    userId: number,
    game: {
      title: string;
      platform: string;
      playtimeMinutes: number | null;
      coverUrl: string | null;
    },
  ): number {
    const info = this.db
      .prepare(
        'INSERT INTO manual_game (user_id, title, platform, playtime_minutes, cover_url, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        userId,
        game.title,
        game.platform,
        game.playtimeMinutes,
        game.coverUrl,
        new Date().toISOString(),
      );
    return Number(info.lastInsertRowid);
  }

  listManualGames(userId: number): Array<{
    id: number;
    title: string;
    platform: string;
    playtime_minutes: number | null;
    cover_url: string | null;
  }> {
    return this.db
      .prepare(
        'SELECT id, title, platform, playtime_minutes, cover_url FROM manual_game WHERE user_id = ? ORDER BY id DESC',
      )
      .all(userId) as Array<{
      id: number;
      title: string;
      platform: string;
      playtime_minutes: number | null;
      cover_url: string | null;
    }>;
  }

  deleteManualGame(userId: number, id: number): void {
    this.db.prepare('DELETE FROM manual_game WHERE user_id = ? AND id = ?').run(userId, id);
  }

  /** Update a manual game's playtime. Returns false if no such game exists for this user. */
  setManualGamePlaytime(userId: number, id: number, playtimeMinutes: number | null): boolean {
    const info = this.db
      .prepare('UPDATE manual_game SET playtime_minutes = ? WHERE user_id = ? AND id = ?')
      .run(playtimeMinutes, userId, id);
    return Number(info.changes) > 0;
  }

  addBacklogGame(
    userId: number,
    game: {
      title: string;
      platform: string;
      coverUrl: string | null;
      priority: number;
      notes: string | null;
    },
  ): number {
    const info = this.db
      .prepare(
        'INSERT INTO backlog (user_id, title, platform, cover_url, priority, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        userId,
        game.title,
        game.platform,
        game.coverUrl,
        game.priority,
        game.notes,
        new Date().toISOString(),
      );
    return Number(info.lastInsertRowid);
  }

  listBacklogGames(userId: number): Array<{
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
        'SELECT id, title, platform, cover_url, priority, notes, created_at FROM backlog WHERE user_id = ? ORDER BY priority DESC, id DESC',
      )
      .all(userId) as Array<{
      id: number;
      title: string;
      platform: string;
      cover_url: string | null;
      priority: number;
      notes: string | null;
      created_at: string;
    }>;
  }

  getBacklogGame(
    userId: number,
    id: number,
  ):
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
        'SELECT id, title, platform, cover_url, priority, notes, created_at FROM backlog WHERE user_id = ? AND id = ?',
      )
      .get(userId, id) as
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

  setBacklogPriority(userId: number, id: number, priority: number): void {
    this.db
      .prepare('UPDATE backlog SET priority = ? WHERE user_id = ? AND id = ?')
      .run(priority, userId, id);
  }

  deleteBacklogGame(userId: number, id: number): void {
    this.db.prepare('DELETE FROM backlog WHERE user_id = ? AND id = ?').run(userId, id);
  }

  setMeta(gameKey: string, data: unknown): void {
    this.db
      .prepare(
        `INSERT INTO game_meta (game_key, data, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(game_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
      )
      .run(gameKey, JSON.stringify(data), new Date().toISOString());
  }

  setRating(userId: number, gameKey: string, rating: number): void {
    if (!rating) {
      this.db
        .prepare('DELETE FROM game_rating WHERE user_id = ? AND game_key = ?')
        .run(userId, gameKey);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO game_rating (user_id, game_key, rating, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, game_key) DO UPDATE SET rating = excluded.rating, updated_at = excluded.updated_at`,
      )
      .run(userId, gameKey, rating, new Date().toISOString());
  }

  getRatings(userId: number): Map<string, number> {
    const rows = this.db
      .prepare('SELECT game_key, rating FROM game_rating WHERE user_id = ?')
      .all(userId) as Array<{
      game_key: string;
      rating: number;
    }>;
    return new Map(rows.map((r) => [r.game_key, r.rating]));
  }

  getMeta<T>(gameKey: string): T | null {
    const row = this.db.prepare('SELECT data FROM game_meta WHERE game_key = ?').get(gameKey) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as T) : null;
  }

  saveSnapshot(userId: number, createdAt: string, data: unknown): void {
    this.db
      .prepare('INSERT INTO snapshot (user_id, created_at, data) VALUES (?, ?, ?)')
      .run(userId, createdAt, JSON.stringify(data));
  }

  /** Map of title id -> lastUpdatedDateTime already stored, for incremental sync diffing. */
  getTrophyTitleState(userId: number): Map<string, string> {
    const rows = this.db
      .prepare('SELECT np_comm_id, last_updated FROM title_trophies WHERE user_id = ?')
      .all(userId) as Array<{ np_comm_id: string; last_updated: string | null }>;
    return new Map(rows.map((r) => [r.np_comm_id, r.last_updated ?? '']));
  }

  upsertTitleTrophies(
    userId: number,
    npCommId: string,
    lastUpdated: string | undefined,
    trophies: unknown,
  ): void {
    this.db
      .prepare(
        `INSERT INTO title_trophies (user_id, np_comm_id, last_updated, data, fetched_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, np_comm_id) DO UPDATE SET last_updated = excluded.last_updated, data = excluded.data, fetched_at = excluded.fetched_at`,
      )
      .run(userId, npCommId, lastUpdated ?? null, JSON.stringify(trophies), new Date().toISOString());
  }

  getAllStoredTrophies<T>(userId: number): T[] {
    const rows = this.db
      .prepare('SELECT data FROM title_trophies WHERE user_id = ?')
      .all(userId) as Array<{
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

  getLatestSnapshot<T>(userId: number): StoredSnapshot<T> | null {
    const row = this.db
      .prepare('SELECT id, created_at, data FROM snapshot WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .get(userId) as { id: number; created_at: string; data: string } | undefined;
    if (!row) return null;
    return { id: row.id, createdAt: row.created_at, data: JSON.parse(row.data) as T };
  }
}
