/**
 * One-time data migration: copy an existing SQLite `playvault.db` into a Postgres database.
 *
 * Usage (from backend/):
 *   npm run build
 *   DATABASE_URL="postgres://user:pass@host/db?sslmode=require" \
 *     node scripts/migrate-sqlite-to-postgres.mjs [path-to-sqlite-db]
 *
 * Defaults to ./playvault.db. Idempotent-ish: it creates the schema if missing and skips rows
 * that already exist (ON CONFLICT DO NOTHING), so re-running won't duplicate data.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { SCHEMA } from '../dist/db/database.service.js';

const sqlitePath = process.argv[2] ?? join(process.cwd(), 'playvault.db');
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('Set DATABASE_URL to your Postgres connection string.');
  process.exit(1);
}
if (!existsSync(sqlitePath)) {
  console.error(`SQLite file not found: ${sqlitePath}`);
  process.exit(1);
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const pool = new pg.Pool({
  connectionString,
  ssl: /sslmode=require|neon\.tech|supabase/.test(connectionString)
    ? { rejectUnauthorized: false }
    : undefined,
});

/** Read every row of a SQLite table (empty if the table doesn't exist). */
function read(table) {
  try {
    return sqlite.prepare(`SELECT * FROM ${table}`).all();
  } catch {
    return [];
  }
}

/** Insert rows into Postgres, one parameterized statement per row, skipping conflicts. */
async function copy(table, columns, rows, transform = (r) => r) {
  if (!rows.length) return 0;
  const cols = columns.join(', ');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
  let n = 0;
  for (const row of rows) {
    const t = transform(row);
    await pool.query(sql, columns.map((c) => t[c]));
    n++;
  }
  return n;
}

/** Advance a SERIAL sequence past the max id we copied, so new inserts don't collide. */
async function resetSequence(table) {
  await pool.query(
    `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`,
    [table],
  );
}

async function main() {
  console.log(`Migrating ${sqlitePath} -> Postgres`);
  for (const stmt of SCHEMA) await pool.query(stmt);

  const counts = {};
  counts.users = await copy(
    'users',
    ['id', 'google_sub', 'email', 'name', 'picture', 'password_hash', 'created_at'],
    read('users'),
  );
  counts.user_connections = await copy(
    'user_connections',
    ['user_id', 'psn_npsso', 'steam_id', 'updated_at'],
    read('user_connections'),
  );
  counts.snapshot = await copy(
    'snapshot',
    ['id', 'user_id', 'created_at', 'data'],
    read('snapshot'),
  );
  counts.game_flags = await copy(
    'game_flags',
    ['user_id', 'game_key', 'beaten', 'updated_at'],
    read('game_flags'),
    (r) => ({ ...r, beaten: !!r.beaten }), // SQLite 0/1 -> Postgres boolean
  );
  counts.game_playing = await copy(
    'game_playing',
    ['user_id', 'game_key', 'updated_at'],
    read('game_playing'),
  );
  counts.game_meta = await copy('game_meta', ['game_key', 'data', 'fetched_at'], read('game_meta'));
  counts.manual_game = await copy(
    'manual_game',
    ['id', 'user_id', 'title', 'platform', 'playtime_minutes', 'cover_url', 'created_at'],
    read('manual_game'),
  );
  counts.game_rating = await copy(
    'game_rating',
    ['user_id', 'game_key', 'rating', 'updated_at'],
    read('game_rating'),
  );
  counts.backlog = await copy(
    'backlog',
    ['id', 'user_id', 'title', 'platform', 'cover_url', 'priority', 'notes', 'created_at'],
    read('backlog'),
  );
  counts.title_trophies = await copy(
    'title_trophies',
    ['user_id', 'np_comm_id', 'last_updated', 'data', 'fetched_at'],
    read('title_trophies'),
  );

  for (const table of ['users', 'snapshot', 'manual_game', 'backlog']) await resetSequence(table);

  console.table(counts);
  console.log('Done.');
  await pool.end();
  sqlite.close();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
