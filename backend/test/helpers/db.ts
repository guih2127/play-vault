import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { DatabaseService } from '../../src/db/database.service.js';

/**
 * A fresh, fully-isolated DatabaseService backed by an in-memory Postgres (pg-mem). Each call
 * gets its own database, so tests never share state, and the real schema/queries run unchanged.
 */
export async function makeTestDb(): Promise<DatabaseService> {
  const mem = newDb();
  const { Pool: MemPool } = mem.adapters.createPg();
  const db = new DatabaseService();
  await db.onModuleInit(new MemPool() as unknown as Pool);
  return db;
}
