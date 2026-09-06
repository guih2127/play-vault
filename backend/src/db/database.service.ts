import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

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
  xbox_rtoken: string | null;
  xbox_xuid: string | null;
  xbox_gamertag: string | null;
  updated_at: string;
}

// Timestamps are stored as ISO strings (TEXT) and JSON blobs as TEXT — the app never queries
// inside them, so JSONB buys nothing and TEXT keeps the (de)serialization identical to before.
// Exported so the one-time SQLite->Postgres migration script can create the same schema.
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    google_sub TEXT UNIQUE,
    email TEXT,
    name TEXT,
    picture TEXT,
    password_hash TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_connections (
    user_id INTEGER PRIMARY KEY,
    psn_npsso TEXT,
    steam_id TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS snapshot (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    data TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS game_flags (
    user_id INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    beaten BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, game_key)
  )`,
  `CREATE TABLE IF NOT EXISTS game_playing (
    user_id INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, game_key)
  )`,
  `CREATE TABLE IF NOT EXISTS game_meta (
    game_key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS manual_game (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    platform TEXT NOT NULL,
    playtime_minutes INTEGER,
    cover_url TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS game_rating (
    user_id INTEGER NOT NULL,
    game_key TEXT NOT NULL,
    rating REAL NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, game_key)
  )`,
  `CREATE TABLE IF NOT EXISTS backlog (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    platform TEXT NOT NULL,
    cover_url TEXT,
    priority INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS title_trophies (
    user_id INTEGER NOT NULL,
    np_comm_id TEXT NOT NULL,
    last_updated TEXT,
    data TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (user_id, np_comm_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshot_user ON snapshot (user_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_manual_user ON manual_game (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_backlog_user ON backlog (user_id)`,
  // Xbox Live connection (added after the initial schema): the Microsoft OAuth refresh token
  // (encrypted), the resolved Xbox user id and the gamertag. Idempotent so boots stay safe.
  `ALTER TABLE user_connections ADD COLUMN IF NOT EXISTS xbox_rtoken TEXT`,
  `ALTER TABLE user_connections ADD COLUMN IF NOT EXISTS xbox_xuid TEXT`,
  `ALTER TABLE user_connections ADD COLUMN IF NOT EXISTS xbox_gamertag TEXT`,
];

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;

  /** `poolOverride` lets tests inject an in-memory (pg-mem) pool. Nest calls this with no args. */
  async onModuleInit(poolOverride?: Pool): Promise<void> {
    // Already initialized (e.g. a test injected a pool before Nest ran the lifecycle hook).
    if (this.pool) return;
    this.pool =
      poolOverride ??
      new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      });
    for (const stmt of SCHEMA) await this.pool.query(stmt);
    this.logger.log('Postgres database ready');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async upsertUser(u: {
    googleSub: string;
    email?: string;
    name?: string;
    picture?: string;
  }): Promise<DbUser> {
    const res = await this.pool.query(
      `INSERT INTO users (google_sub, email, name, picture, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (google_sub) DO UPDATE SET
         email = EXCLUDED.email, name = EXCLUDED.name, picture = EXCLUDED.picture
       RETURNING *`,
      [u.googleSub, u.email ?? null, u.name ?? null, u.picture ?? null, new Date().toISOString()],
    );
    return res.rows[0] as DbUser;
  }

  async getUserById(id: number): Promise<DbUser | null> {
    const res = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return (res.rows[0] as DbUser) ?? null;
  }

  async listUsers(): Promise<DbUser[]> {
    const res = await this.pool.query('SELECT * FROM users ORDER BY id ASC');
    return res.rows as DbUser[];
  }

  async getUserByEmail(email: string): Promise<DbUser | null> {
    const res = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return (res.rows[0] as DbUser) ?? null;
  }

  async createPasswordUser(u: {
    email: string;
    name?: string;
    passwordHash: string;
  }): Promise<DbUser> {
    const res = await this.pool.query(
      `INSERT INTO users (email, name, password_hash, created_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [u.email, u.name ?? null, u.passwordHash, new Date().toISOString()],
    );
    return res.rows[0] as DbUser;
  }

  async getConnections(userId: number): Promise<DbConnections | null> {
    const res = await this.pool.query('SELECT * FROM user_connections WHERE user_id = $1', [userId]);
    return (res.rows[0] as DbConnections) ?? null;
  }

  async setPsnNpsso(userId: number, npsso: string | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_connections (user_id, psn_npsso, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET psn_npsso = EXCLUDED.psn_npsso, updated_at = EXCLUDED.updated_at`,
      [userId, npsso, new Date().toISOString()],
    );
  }

  async setSteamId(userId: number, steamId: string | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_connections (user_id, steam_id, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET steam_id = EXCLUDED.steam_id, updated_at = EXCLUDED.updated_at`,
      [userId, steamId, new Date().toISOString()],
    );
  }

  /** Store (or clear, when passed nulls) the Xbox connection. `rtoken` should already be encrypted. */
  async setXbox(
    userId: number,
    xbox: { rtoken: string; xuid: string; gamertag: string | null } | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_connections (user_id, xbox_rtoken, xbox_xuid, xbox_gamertag, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         xbox_rtoken = EXCLUDED.xbox_rtoken,
         xbox_xuid = EXCLUDED.xbox_xuid,
         xbox_gamertag = EXCLUDED.xbox_gamertag,
         updated_at = EXCLUDED.updated_at`,
      [userId, xbox?.rtoken ?? null, xbox?.xuid ?? null, xbox?.gamertag ?? null, new Date().toISOString()],
    );
  }

  /** Persist a rotated Microsoft refresh token (already encrypted) without touching other fields. */
  async updateXboxRefreshToken(userId: number, rtoken: string): Promise<void> {
    await this.pool.query(
      `UPDATE user_connections SET xbox_rtoken = $2, updated_at = $3 WHERE user_id = $1`,
      [userId, rtoken, new Date().toISOString()],
    );
  }

  async setBeaten(userId: number, gameKey: string, beaten: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO game_flags (user_id, game_key, beaten, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, game_key) DO UPDATE SET beaten = EXCLUDED.beaten, updated_at = EXCLUDED.updated_at`,
      [userId, gameKey, beaten, new Date().toISOString()],
    );
  }

  async getBeatenKeys(userId: number): Promise<Set<string>> {
    const res = await this.pool.query(
      'SELECT game_key FROM game_flags WHERE user_id = $1 AND beaten = TRUE',
      [userId],
    );
    return new Set(res.rows.map((r) => r.game_key as string));
  }

  async setBeatenDate(userId: number, gameKey: string, date: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO game_flags (user_id, game_key, beaten, updated_at) VALUES ($1, $2, TRUE, $3)
       ON CONFLICT (user_id, game_key) DO UPDATE SET beaten = TRUE, updated_at = EXCLUDED.updated_at`,
      [userId, gameKey, date],
    );
  }

  async getBeatenDates(userId: number): Promise<Map<string, string>> {
    const res = await this.pool.query(
      'SELECT game_key, updated_at FROM game_flags WHERE user_id = $1 AND beaten = TRUE',
      [userId],
    );
    return new Map(res.rows.map((r) => [r.game_key as string, r.updated_at as string]));
  }

  async setPlaying(userId: number, gameKey: string, playing: boolean): Promise<void> {
    if (!playing) {
      await this.pool.query('DELETE FROM game_playing WHERE user_id = $1 AND game_key = $2', [
        userId,
        gameKey,
      ]);
      return;
    }
    await this.pool.query(
      `INSERT INTO game_playing (user_id, game_key, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, game_key) DO UPDATE SET updated_at = EXCLUDED.updated_at`,
      [userId, gameKey, new Date().toISOString()],
    );
  }

  async getPlayingKeys(userId: number): Promise<Set<string>> {
    const res = await this.pool.query('SELECT game_key FROM game_playing WHERE user_id = $1', [
      userId,
    ]);
    return new Set(res.rows.map((r) => r.game_key as string));
  }

  async addManualGame(
    userId: number,
    game: {
      title: string;
      platform: string;
      playtimeMinutes: number | null;
      coverUrl: string | null;
    },
  ): Promise<number> {
    const res = await this.pool.query(
      `INSERT INTO manual_game (user_id, title, platform, playtime_minutes, cover_url, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, game.title, game.platform, game.playtimeMinutes, game.coverUrl, new Date().toISOString()],
    );
    return Number(res.rows[0].id);
  }

  async listManualGames(userId: number): Promise<
    Array<{
      id: number;
      title: string;
      platform: string;
      playtime_minutes: number | null;
      cover_url: string | null;
    }>
  > {
    const res = await this.pool.query(
      'SELECT id, title, platform, playtime_minutes, cover_url FROM manual_game WHERE user_id = $1 ORDER BY id DESC',
      [userId],
    );
    return res.rows as Array<{
      id: number;
      title: string;
      platform: string;
      playtime_minutes: number | null;
      cover_url: string | null;
    }>;
  }

  async deleteManualGame(userId: number, id: number): Promise<void> {
    await this.pool.query('DELETE FROM manual_game WHERE user_id = $1 AND id = $2', [userId, id]);
  }

  /** Update a manual game's playtime. Returns false if no such game exists for this user. */
  async setManualGamePlaytime(
    userId: number,
    id: number,
    playtimeMinutes: number | null,
  ): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE manual_game SET playtime_minutes = $1 WHERE user_id = $2 AND id = $3',
      [playtimeMinutes, userId, id],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async addBacklogGame(
    userId: number,
    game: {
      title: string;
      platform: string;
      coverUrl: string | null;
      priority: number;
      notes: string | null;
    },
  ): Promise<number> {
    const res = await this.pool.query(
      `INSERT INTO backlog (user_id, title, platform, cover_url, priority, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, game.title, game.platform, game.coverUrl, game.priority, game.notes, new Date().toISOString()],
    );
    return Number(res.rows[0].id);
  }

  async listBacklogGames(userId: number): Promise<
    Array<{
      id: number;
      title: string;
      platform: string;
      cover_url: string | null;
      priority: number;
      notes: string | null;
      created_at: string;
    }>
  > {
    const res = await this.pool.query(
      'SELECT id, title, platform, cover_url, priority, notes, created_at FROM backlog WHERE user_id = $1 ORDER BY priority DESC, id DESC',
      [userId],
    );
    return res.rows as Array<{
      id: number;
      title: string;
      platform: string;
      cover_url: string | null;
      priority: number;
      notes: string | null;
      created_at: string;
    }>;
  }

  async getBacklogGame(
    userId: number,
    id: number,
  ): Promise<
    | {
        id: number;
        title: string;
        platform: string;
        cover_url: string | null;
        priority: number;
        notes: string | null;
        created_at: string;
      }
    | undefined
  > {
    const res = await this.pool.query(
      'SELECT id, title, platform, cover_url, priority, notes, created_at FROM backlog WHERE user_id = $1 AND id = $2',
      [userId, id],
    );
    return res.rows[0] as
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

  async setBacklogPriority(userId: number, id: number, priority: number): Promise<void> {
    await this.pool.query('UPDATE backlog SET priority = $1 WHERE user_id = $2 AND id = $3', [
      priority,
      userId,
      id,
    ]);
  }

  async deleteBacklogGame(userId: number, id: number): Promise<void> {
    await this.pool.query('DELETE FROM backlog WHERE user_id = $1 AND id = $2', [userId, id]);
  }

  async setMeta(gameKey: string, data: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO game_meta (game_key, data, fetched_at) VALUES ($1, $2, $3)
       ON CONFLICT (game_key) DO UPDATE SET data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at`,
      [gameKey, JSON.stringify(data), new Date().toISOString()],
    );
  }

  async setRating(userId: number, gameKey: string, rating: number): Promise<void> {
    if (!rating) {
      await this.pool.query('DELETE FROM game_rating WHERE user_id = $1 AND game_key = $2', [
        userId,
        gameKey,
      ]);
      return;
    }
    await this.pool.query(
      `INSERT INTO game_rating (user_id, game_key, rating, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, game_key) DO UPDATE SET rating = EXCLUDED.rating, updated_at = EXCLUDED.updated_at`,
      [userId, gameKey, rating, new Date().toISOString()],
    );
  }

  async getRatings(userId: number): Promise<Map<string, number>> {
    const res = await this.pool.query('SELECT game_key, rating FROM game_rating WHERE user_id = $1', [
      userId,
    ]);
    return new Map(res.rows.map((r) => [r.game_key as string, Number(r.rating)]));
  }

  async getMeta<T>(gameKey: string): Promise<T | null> {
    const res = await this.pool.query('SELECT data FROM game_meta WHERE game_key = $1', [gameKey]);
    return res.rows[0] ? (JSON.parse(res.rows[0].data) as T) : null;
  }

  async saveSnapshot(userId: number, createdAt: string, data: unknown): Promise<void> {
    await this.pool.query('INSERT INTO snapshot (user_id, created_at, data) VALUES ($1, $2, $3)', [
      userId,
      createdAt,
      JSON.stringify(data),
    ]);
  }

  /** Map of title id -> lastUpdatedDateTime already stored, for incremental sync diffing. */
  async getTrophyTitleState(userId: number): Promise<Map<string, string>> {
    const res = await this.pool.query(
      'SELECT np_comm_id, last_updated FROM title_trophies WHERE user_id = $1',
      [userId],
    );
    return new Map(res.rows.map((r) => [r.np_comm_id as string, (r.last_updated as string) ?? '']));
  }

  async upsertTitleTrophies(
    userId: number,
    npCommId: string,
    lastUpdated: string | undefined,
    trophies: unknown,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO title_trophies (user_id, np_comm_id, last_updated, data, fetched_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, np_comm_id) DO UPDATE SET last_updated = EXCLUDED.last_updated, data = EXCLUDED.data, fetched_at = EXCLUDED.fetched_at`,
      [userId, npCommId, lastUpdated ?? null, JSON.stringify(trophies), new Date().toISOString()],
    );
  }

  async getAllStoredTrophies<T>(userId: number): Promise<T[]> {
    const res = await this.pool.query('SELECT data FROM title_trophies WHERE user_id = $1', [userId]);
    const out: T[] = [];
    for (const r of res.rows) {
      try {
        const arr = JSON.parse(r.data) as T[];
        if (Array.isArray(arr)) out.push(...arr);
      } catch {
        // skip malformed rows
      }
    }
    return out;
  }

  async getLatestSnapshot<T>(userId: number): Promise<StoredSnapshot<T> | null> {
    const res = await this.pool.query(
      'SELECT id, created_at, data FROM snapshot WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
      [userId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return { id: Number(row.id), createdAt: row.created_at, data: JSON.parse(row.data) as T };
  }
}
