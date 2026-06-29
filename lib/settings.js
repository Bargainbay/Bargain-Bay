// Tiny key/value settings store for owner-configurable knobs (revenue goal,
// opening cash balance, etc.). Self-provisioning single table; values are JSON
// so callers can store numbers, strings, or small objects. Safe no-op w/o a DB.
import { query, hasDb } from './db';

let ensured = null;
async function ensure() {
  if (!hasDb()) return;
  if (ensured) return ensured;
  ensured = query(`
    CREATE TABLE IF NOT EXISTS settings (
      key        text PRIMARY KEY,
      value      jsonb,
      updated_at timestamptz DEFAULT now()
    )
  `).catch((e) => { ensured = null; throw e; });
  return ensured;
}

export async function getSetting(key, fallback = null) {
  if (!hasDb()) return fallback;
  try {
    await ensure();
    const { rows } = await query('SELECT value FROM settings WHERE key = $1', [key]);
    return rows.length ? rows[0].value : fallback;
  } catch { return fallback; }
}

export async function setSetting(key, value) {
  if (!hasDb()) return false;
  await ensure();
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
  return true;
}

// Convenience: read several keys at once → { key: value|fallback }.
export async function getSettings(keys = {}) {
  const out = {};
  await Promise.all(Object.entries(keys).map(async ([k, fb]) => { out[k] = await getSetting(k, fb); }));
  return out;
}
