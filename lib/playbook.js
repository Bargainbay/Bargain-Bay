// The company playbook — the owner's own training that turns Sarah from an
// inventory bot into "the brain of the company." One editable document (how the
// business runs, how to handle situations) that gets injected into Sarah's
// context on every channel. Self-provisioning, cached so it's ~free to read.
import { hasDb, query } from './db';

let _schema = null;
function ensureSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS sarah_playbook (
        id int PRIMARY KEY,
        content text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

let _cache = { content: '', at: 0 };
const TTL = 60 * 1000; // edits propagate to Sarah within a minute

export async function getPlaybook({ fresh = false } = {}) {
  if (!hasDb()) return '';
  if (!fresh && _cache.at && Date.now() - _cache.at < TTL) return _cache.content;
  try {
    await ensureSchema();
    const { rows } = await query('SELECT content FROM sarah_playbook WHERE id = 1');
    const content = rows[0]?.content || '';
    _cache = { content, at: Date.now() };
    return content;
  } catch (e) {
    console.error('getPlaybook failed', e?.message || e);
    return _cache.content || '';
  }
}

export async function setPlaybook(content) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureSchema();
  const text = String(content || '').slice(0, 50000);
  await query(
    `INSERT INTO sarah_playbook (id, content, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
    [text]
  );
  _cache = { content: text, at: Date.now() };
  return text;
}

// Append a learned note (used by the in-chat `remember` tool) under a notes
// heading, so things the owner teaches Sarah persist into the playbook.
export async function appendToPlaybook(note) {
  const clean = String(note || '').trim();
  if (!clean) return getPlaybook({ fresh: true });
  const cur = await getPlaybook({ fresh: true });
  const heading = '## Notes Sarah has learned';
  let next;
  if (cur.includes(heading)) {
    next = cur.replace(heading, `${heading}\n- ${clean}`);
  } else {
    next = `${cur ? cur.trim() + '\n\n' : ''}${heading}\n- ${clean}`;
  }
  return setPlaybook(next);
}
