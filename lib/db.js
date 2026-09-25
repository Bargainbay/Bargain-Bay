// Postgres pool (Neon / Vercel Postgres in prod, any Postgres locally).
// IMPORTANT: the pool is lazy — nothing touches POSTGRES_URL at module load,
// so `next build` succeeds without a database configured.
import { Pool } from 'pg';

let pool = null;

export function hasDb() {
  return !!process.env.POSTGRES_URL;
}

// TLS for the database connection.
//
// This used to be `{ rejectUnauthorized: false }` unconditionally, which
// accepts ANY certificate — including one presented by something that is not
// our database. It turns TLS into encryption without authentication, which
// stops a passive eavesdropper and does nothing at all about an active one.
//
// Neon and Vercel Postgres both present certificates from a public CA, so
// Node's built-in trust store verifies them with no configuration. That is the
// default here.
//
// Two escape hatches, because a database that cannot be reached is worse than
// one reached over a connection nobody is attacking today:
//   · POSTGRES_CA_CERT — a PEM bundle, for a provider with a private CA.
//   · POSTGRES_SSL_INSECURE=1 — the old behaviour, deliberately ugly to set.
//     If you need it, you are papering over a real certificate problem: find
//     out whose certificate it is before leaving it on.
function sslConfig(connectionString) {
  const local = /localhost|127\.0\.0\.1/.test(connectionString);
  // A local socket or an explicit sslmode=disable means no TLS at all.
  if (local || /[?&]sslmode=disable\b/.test(connectionString)) return undefined;

  if (process.env.POSTGRES_SSL_INSECURE === '1') {
    console.warn(
      'POSTGRES_SSL_INSECURE=1 — database certificate is NOT being verified. ' +
      'This is an escape hatch, not a setting. Remove it once the cert chain is fixed.'
    );
    return { rejectUnauthorized: false };
  }

  const ca = process.env.POSTGRES_CA_CERT;
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

export function getPool() {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) throw new Error('POSTGRES_URL is not set');
    pool = new Pool({
      connectionString,
      max: 5,
      // Fail fast instead of hanging forever when the (small) pool is saturated —
      // an unthrottled flood otherwise queues requests indefinitely and takes the
      // whole DB-backed site down. statement_timeout caps any single slow query.
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      statement_timeout: 10000,
      ssl: sslConfig(connectionString)
    });
    // An idle client erroring out (a provider dropping a pooled connection) is
    // emitted on the pool, and an 'error' event with no listener is an
    // uncaught exception that takes the whole function down with it.
    pool.on('error', (e) => console.error('pg idle client error', e.message));
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
