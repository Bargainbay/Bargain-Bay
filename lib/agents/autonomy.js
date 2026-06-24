// Graduated autonomy — the "switch we flip, not a rebuild" the owner asked for.
// Every agent has an autonomyLevel that starts at advise-only and can be ramped
// up per agent as its department playbook fills in with the owner's confirmed
// rules. The level changes how the agent behaves (see AUTONOMY_NOTES below) and
// is read into the system prompt on every turn.
//
// Self-provisioning, cached. Default level comes from the agent registry; only
// overrides are stored, so a fresh deploy needs no migration and no seeding.
import { hasDb, query } from './../db';

// The three rungs of the dial, in order. `advise` is the safe default.
export const AUTONOMY_LEVELS = ['advise', 'routine', 'autonomous'];

export function isAutonomyLevel(x) {
  return AUTONOMY_LEVELS.includes(String(x));
}

// Behaviour injected into the system prompt for each rung.
export const AUTONOMY_NOTES = {
  advise: `YOUR AUTONOMY RIGHT NOW: ADVISE-ONLY. Answer and advise freely on your own, but ANY real action — emailing a customer, creating or changing an invoice, taking a payment, changing inventory or a price, scheduling a delivery — must be confirmed by the owner before you do it. Restate exactly what you'll do and wait for a clear yes. When the owner approves or corrects you, save that decision with the remember tool so you can handle it yourself once you're trusted to.`,
  routine: `YOUR AUTONOMY RIGHT NOW: HANDLE ROUTINE. When your department playbook clearly and repeatedly covers a situation, you may take the routine action on your own without asking first — then report what you did. For anything unusual, high-stakes, money-sensitive beyond the routine, or not covered by the playbook, still say what you'd do and confirm with the owner. Keep saving new confirmed decisions with remember.`,
  autonomous: `YOUR AUTONOMY RIGHT NOW: AUTONOMOUS. You may take actions in your area on your own and report them afterward. Still escalate genuinely unusual, high-stakes, or out-of-policy situations to the owner before acting. Keep saving new confirmed decisions with remember so your judgment stays in sync with how the owner wants things run.`
};

export function autonomyNote(level) {
  return AUTONOMY_NOTES[isAutonomyLevel(level) ? level : 'advise'];
}

let _schema = null;
function ensureSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS sarah_agent_settings (
        agent_key text PRIMARY KEY,
        autonomy_level text NOT NULL DEFAULT 'advise',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

const _cache = new Map(); // agent_key -> { level, at }
const TTL = 30 * 1000;

// Resolve an agent's current level, falling back to the registry default.
export async function getAutonomy(agentKey, fallback = 'advise') {
  const key = String(agentKey || '').trim();
  if (!key || !hasDb()) return fallback;
  const cached = _cache.get(key);
  if (cached && Date.now() - cached.at < TTL) return cached.level;
  try {
    await ensureSchema();
    const { rows } = await query('SELECT autonomy_level FROM sarah_agent_settings WHERE agent_key = $1', [key]);
    const level = isAutonomyLevel(rows[0]?.autonomy_level) ? rows[0].autonomy_level : fallback;
    _cache.set(key, { level, at: Date.now() });
    return level;
  } catch (e) {
    console.error('getAutonomy failed', e?.message || e);
    return cached?.level || fallback;
  }
}

export async function setAutonomy(agentKey, level) {
  if (!hasDb()) throw new Error('Database not configured.');
  const key = String(agentKey || '').trim();
  if (!key) throw new Error('Missing agent.');
  if (!isAutonomyLevel(level)) throw new Error(`Invalid autonomy level: ${level}`);
  await ensureSchema();
  await query(
    `INSERT INTO sarah_agent_settings (agent_key, autonomy_level, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (agent_key) DO UPDATE SET autonomy_level = EXCLUDED.autonomy_level, updated_at = now()`,
    [key, level]
  );
  _cache.set(key, { level, at: Date.now() });
  return level;
}

// Load levels for a list of agents in one shot (for the admin dashboard).
export async function getAutonomyMap(agents) {
  const out = {};
  if (!hasDb()) {
    for (const a of agents) out[a.key] = a.defaultAutonomy || 'advise';
    return out;
  }
  try {
    await ensureSchema();
    const { rows } = await query('SELECT agent_key, autonomy_level FROM sarah_agent_settings');
    const stored = {};
    for (const r of rows) if (isAutonomyLevel(r.autonomy_level)) stored[r.agent_key] = r.autonomy_level;
    for (const a of agents) out[a.key] = stored[a.key] || a.defaultAutonomy || 'advise';
  } catch (e) {
    console.error('getAutonomyMap failed', e?.message || e);
    for (const a of agents) out[a.key] = a.defaultAutonomy || 'advise';
  }
  return out;
}
