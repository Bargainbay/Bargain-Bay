// Transient hosting for Sarah's spoken replies. Twilio needs a PUBLIC URL to
// fetch a WhatsApp voice note, but the app's Vercel Blob store is private (it
// holds POD photos). So instead of Blob, we stash the TTS mp3 in Postgres for a
// short window and serve it from a public app route (/api/sarah/voice/[id]).
// Self-provisioning table — no migration. IDs are unguessable; rows auto-expire.
import { hasDb, query } from './db';
import crypto from 'crypto';

let _schema = null;
function ensureSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS sarah_audio (
        id text PRIMARY KEY,
        bytes bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// Store an mp3 buffer, return its unguessable id (or null on failure/no DB).
export async function storeAudio(buffer) {
  if (!hasDb() || !buffer || !buffer.length) return null;
  await ensureSchema();
  const id = crypto.randomBytes(16).toString('hex');
  await query('INSERT INTO sarah_audio (id, bytes) VALUES ($1, $2)', [id, buffer]);
  // Opportunistic cleanup — these are throwaway clips; keep the table tiny.
  query("DELETE FROM sarah_audio WHERE created_at < now() - interval '1 hour'").catch(() => {});
  return id;
}

// Fetch the mp3 bytes for an id (Buffer), or null if missing/expired.
export async function getAudio(id) {
  if (!hasDb() || !id) return null;
  await ensureSchema();
  const { rows } = await query('SELECT bytes FROM sarah_audio WHERE id = $1', [String(id)]);
  return rows.length ? rows[0].bytes : null;
}
