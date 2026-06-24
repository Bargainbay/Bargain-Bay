// Per-sender conversation memory for Sarah's messaging channels (WhatsApp/SMS)
// plus the owner allowlist. Self-provisioning table — works on deploy with no
// manual migration. The web copilot keeps its transcript client-side, so this is
// only used by the phone channels, keyed by the sender's number.
import { hasDb, query } from './db';

let _schema = null;
function ensureSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS sarah_messages (
        id serial PRIMARY KEY,
        sender text NOT NULL,
        role text NOT NULL,
        content text NOT NULL,
        provider_message_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sarah_messages_sender_idx ON sarah_messages (sender, id);
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// Strip the 'whatsapp:' prefix and any formatting so numbers compare cleanly.
export function normalizePhone(s) {
  return String(s || '').replace(/^whatsapp:/i, '').replace(/[^\d+]/g, '').trim();
}

// Only the owner's number(s) may operate Sarah — she creates invoices and
// changes live stock. SARAH_ALLOWED_NUMBERS is a comma-separated E.164 list.
export function isAllowedSender(phone) {
  const p = normalizePhone(phone);
  if (!p) return false;
  const allow = (process.env.SARAH_ALLOWED_NUMBERS || '').split(',').map((x) => normalizePhone(x)).filter(Boolean);
  return allow.includes(p);
}

// Idempotency: Twilio may re-deliver a webhook — don't act twice on one message.
export async function alreadyProcessed(providerMessageId) {
  if (!hasDb() || !providerMessageId) return false;
  await ensureSchema();
  const { rows } = await query('SELECT 1 FROM sarah_messages WHERE provider_message_id = $1 LIMIT 1', [providerMessageId]);
  return rows.length > 0;
}

// Recent turns for this sender, oldest-first, as a plain {role,content} list.
export async function loadThread(sender, limit = 20) {
  if (!hasDb()) return [];
  await ensureSchema();
  const { rows } = await query(
    'SELECT role, content FROM sarah_messages WHERE sender = $1 ORDER BY id DESC LIMIT $2',
    [String(sender), Math.min(Math.max(limit, 1), 40)]
  );
  return rows.reverse().map((r) => ({ role: r.role, content: r.content }));
}

export async function appendMessage(sender, role, content, providerMessageId = null) {
  if (!hasDb()) return;
  await ensureSchema();
  await query(
    'INSERT INTO sarah_messages (sender, role, content, provider_message_id) VALUES ($1,$2,$3,$4)',
    [String(sender), role, String(content || '').slice(0, 4000), providerMessageId]
  );
}
