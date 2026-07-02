// Review queue for AI-extracted purchase invoices. The email watcher stages each
// invoice's units here; the owner reviews them on Operations before they're written
// into the master tracker. Self-provisioning, no migration.
import { hasDb, query } from './db';
import { addIntakeUnits } from './intake';

let ensured = null;
async function ensure() {
  if (!hasDb()) return;
  if (ensured) return ensured;
  ensured = query(`
    CREATE TABLE IF NOT EXISTS intake_queue (
      id serial PRIMARY KEY,
      source text,                 -- 'email' | 'upload'
      email_msg_id text,           -- gmail message id (idempotency key for email)
      vendor text, invoice text, sender text, subject text,
      items jsonb NOT NULL DEFAULT '[]',
      status text NOT NULL DEFAULT 'pending',  -- pending | committed | rejected
      added_skus jsonb,
      note text,
      created_at timestamptz DEFAULT now(),
      reviewed_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_queue_msg ON intake_queue (email_msg_id) WHERE email_msg_id IS NOT NULL;
  `).catch((e) => { ensured = null; throw e; });
  return ensured;
}

// True if this email was already staged (any status) — so the watcher skips it.
export async function alreadyQueued(emailMsgId) {
  if (!hasDb() || !emailMsgId) return false;
  await ensure();
  const { rows } = await query('SELECT 1 FROM intake_queue WHERE email_msg_id = $1 LIMIT 1', [String(emailMsgId)]);
  return rows.length > 0;
}

export async function enqueue({ source = 'email', emailMsgId = null, vendor, invoice, sender, subject, items, status = 'pending', note = null }) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensure();
  const { rows } = await query(
    `INSERT INTO intake_queue (source, email_msg_id, vendor, invoice, sender, subject, items, status, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (email_msg_id) WHERE email_msg_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [source, emailMsgId ? String(emailMsgId) : null, vendor || null, invoice || null, sender || null, subject || null,
     JSON.stringify(items || []), status, note]
  );
  return rows[0]?.id || null;
}

export async function listPendingIntake() {
  if (!hasDb()) return [];
  await ensure();
  const { rows } = await query("SELECT * FROM intake_queue WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50");
  return rows.map((r) => ({
    id: r.id, source: r.source, vendor: r.vendor, invoice: r.invoice, sender: r.sender,
    subject: r.subject, items: r.items || [], note: r.note,
    createdAt: r.created_at ? r.created_at.toISOString() : null
  }));
}

export async function pendingIntakeCount() {
  if (!hasDb()) return 0;
  await ensure();
  const { rows } = await query("SELECT COUNT(*)::int AS c FROM intake_queue WHERE status = 'pending'");
  return rows[0]?.c || 0;
}

// Approve a queued batch → write its (possibly edited) units into the master tracker.
export async function commitIntake(id, { vendor, invoice, items } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensure();
  const { rows } = await query("SELECT * FROM intake_queue WHERE id = $1 AND status = 'pending'", [id]);
  if (!rows.length) throw new Error('That intake is no longer pending.');
  const q = rows[0];
  const list = Array.isArray(items) ? items : (q.items || []);
  const created = [];
  const failed = [];
  for (const it of list) {
    try {
      const r = await addIntakeUnits({
        make: it.make, model: it.model, category: it.category, cost: it.cost, retail: it.retail,
        description: it.description, vendor: vendor || q.vendor || null, invoice: invoice || q.invoice || null,
        qty: Math.max(1, Math.round(Number(it.qty) || 1))
      });
      created.push(...(r.created || []));
    } catch (e) { failed.push({ model: it.model, error: e?.message || 'failed' }); }
  }
  await query("UPDATE intake_queue SET status = 'committed', added_skus = $2, reviewed_at = now() WHERE id = $1", [id, JSON.stringify(created)]);
  return { addedSkus: created, count: created.length, failed };
}

export async function rejectIntakeQueue(id) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensure();
  await query("UPDATE intake_queue SET status = 'rejected', reviewed_at = now() WHERE id = $1 AND status = 'pending'", [id]);
  return { ok: true };
}
