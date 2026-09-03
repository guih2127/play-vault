import { DatabaseService } from '../../src/db/database.service.js';

/**
 * A fresh, fully-isolated in-memory DatabaseService. Each call gets its own SQLite database, so
 * tests never share state. The schema and migrations run exactly as in production.
 */
export function makeTestDb(): DatabaseService {
  process.env.DATABASE_PATH = ':memory:';
  const db = new DatabaseService();
  db.onModuleInit();
  return db;
}
