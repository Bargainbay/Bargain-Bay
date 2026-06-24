// The company playbook — the owner's own training that turns Sarah's agents from
// inventory bots into "the brain of the company." A GLOBAL document (how the
// business runs, shared by every agent) plus one section PER DEPARTMENT (sales,
// customer service, delivery, technical, …) so each specialist gets the global
// knowledge + its own slice. Injected into the agent's context on every channel.
// Self-provisioning, cached so it's ~free to read.
//
// Storage: the global doc keeps living in `sarah_playbook` (id=1) so nothing has
// to migrate; department sections live in `sarah_playbook_sections` keyed by dept.
import { hasDb, query } from './db';

export const GLOBAL_DEPT = 'global';

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
      CREATE TABLE IF NOT EXISTS sarah_playbook_sections (
        dept text PRIMARY KEY,
        content text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// dept → { content, at } cache. The global doc caches under GLOBAL_DEPT.
const _cache = new Map();
const TTL = 60 * 1000; // edits propagate to the agents within a minute

function normDept(dept) {
  const d = String(dept || GLOBAL_DEPT).trim().toLowerCase();
  return d || GLOBAL_DEPT;
}

// Read a playbook section. dept defaults to the global doc (back-compat:
// getPlaybook() with no args returns the global doc exactly as before).
export async function getPlaybook({ fresh = false, dept = GLOBAL_DEPT } = {}) {
  const key = normDept(dept);
  if (!hasDb()) return '';
  const cached = _cache.get(key);
  if (!fresh && cached && Date.now() - cached.at < TTL) return cached.content;
  try {
    await ensureSchema();
    let content;
    if (key === GLOBAL_DEPT) {
      const { rows } = await query('SELECT content FROM sarah_playbook WHERE id = 1');
      content = rows[0]?.content || '';
    } else {
      const { rows } = await query('SELECT content FROM sarah_playbook_sections WHERE dept = $1', [key]);
      content = rows[0]?.content || '';
    }
    _cache.set(key, { content, at: Date.now() });
    return content;
  } catch (e) {
    console.error('getPlaybook failed', e?.message || e);
    return _cache.get(key)?.content || '';
  }
}

export async function setPlaybook(content, { dept = GLOBAL_DEPT } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensureSchema();
  const key = normDept(dept);
  const text = String(content || '').slice(0, 50000);
  if (key === GLOBAL_DEPT) {
    await query(
      `INSERT INTO sarah_playbook (id, content, updated_at) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [text]
    );
  } else {
    await query(
      `INSERT INTO sarah_playbook_sections (dept, content, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (dept) DO UPDATE SET content = EXCLUDED.content, updated_at = now()`,
      [key, text]
    );
  }
  _cache.set(key, { content: text, at: Date.now() });
  return text;
}

// Append a learned note (used by the in-chat `remember` tool) under a notes
// heading, so things the owner teaches an agent persist into its playbook
// section. dept routes the note to that department's section (or the global doc).
export async function appendToPlaybook(note, dept = GLOBAL_DEPT) {
  const clean = String(note || '').trim();
  const key = normDept(dept);
  if (!clean) return getPlaybook({ fresh: true, dept: key });
  const cur = await getPlaybook({ fresh: true, dept: key });
  const heading = '## Notes I have learned';
  let next;
  if (cur.includes(heading)) {
    next = cur.replace(heading, `${heading}\n- ${clean}`);
  } else {
    next = `${cur ? cur.trim() + '\n\n' : ''}${heading}\n- ${clean}`;
  }
  return setPlaybook(next, { dept: key });
}
