// Review queue for AI-extracted purchase invoices. The email watcher stages each
// invoice's units here; the owner reviews them on Operations before they're written
// into the master tracker. Self-provisioning, no migration.
import { hasDb, query } from './db';
import { addIntakeLines, lotForInvoice } from './intake';
import { matchInvoiceLines, fillWaitingRows } from './stock-reconcile';

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
  let list = Array.isArray(items) ? items : (q.items || []);
  // One batched tracker write for the whole invoice; on failure the batch stays
  // 'pending' so the owner can retry, rather than half-committing line by line.
  const inv = invoice || q.invoice || null;
  const vend = vendor || q.vendor || null;
  // Units RS Ops booked in before this invoice arrived are already on the tracker
  // waiting for it. Fill those rows first, and add only what's left over — the
  // queue has no per-line review of matches, so a model match is taken as read,
  // and a lookup that fails simply adds every line as new, as before.
  let filled = [];
  try {
    const matches = await matchInvoiceLines(list, { invoice: inv || '' });
    if (matches.length) {
      const f = await fillWaitingRows(
        matches.map((m) => ({ line: list[m.line], skus: m.units.map((u) => u.sku) })),
        { vendor: vend, invoice: inv, lot: inv ? lotForInvoice(inv).lot : undefined }
      );
      filled = f.filled;
      const per = new Map(matches.map((m) => [m.line, m.units.filter((u) => filled.includes(u.sku)).length]));
      list = list
        .map((it, i) => ({ ...it, qty: Math.max(1, Math.round(Number(it.qty) || 1)) - (per.get(i) || 0) }))
        .filter((it) => it.qty > 0);
    }
  } catch (e) {
    console.error('intake queue: matching booked-in units failed', e?.message || e);
  }
  const r = list.length ? await addIntakeLines(list, { vendor: vend, invoice: inv }) : { created: [], count: 0 };
  await query("UPDATE intake_queue SET status = 'committed', added_skus = $2, reviewed_at = now() WHERE id = $1", [id, JSON.stringify([...r.created, ...filled])]);
  return { addedSkus: r.created, filledSkus: filled, count: r.count + filled.length, failed: [] };
}

export async function rejectIntakeQueue(id) {
  if (!hasDb()) throw new Error('Database not configured.');
  await ensure();
  await query("UPDATE intake_queue SET status = 'rejected', reviewed_at = now() WHERE id = $1 AND status = 'pending'", [id]);
  return { ok: true };
}
