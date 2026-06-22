// Postgres pool (Neon / Vercel Postgres in prod, any Postgres locally).
// IMPORTANT: the pool is lazy — nothing touches POSTGRES_URL at module load,
// so `next build` succeeds without a database configured.
import { Pool } from 'pg';

let pool = null;

export function hasDb() {
  return !!process.env.POSTGRES_URL;
}

export function getPool() {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) throw new Error('POSTGRES_URL is not set');
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    pool = new Pool({
      connectionString,
      max: 5,
      // Fail fast instead of hanging forever when the (small) pool is saturated —
      // an unthrottled flood otherwise queues requests indefinitely and takes the
      // whole DB-backed site down. statement_timeout caps any single slow query.
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
      ssl: local ? undefined : { rejectUnauthorized: false }
    });
  }
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

// Run fn(client) inside a transaction. Rolls back on throw.
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}
