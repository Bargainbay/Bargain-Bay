// The live bankroll — the WhatsApp ledger, kept here.
//
//   bankroll = what the bank says is available
//            + cash on hand            (every cash movement anyone has entered)
//            + money moved but not at the bank yet   (entered, not yet cleared)
//
// The bank's figure is only as fresh as the last time we asked it, so it always carries its time and
// the page says so. Everything a PERSON adds is a row in bankroll_entries; nothing here is guessed
// from the bank feed. Rows are voided, never deleted.
import { query, hasDb } from './db';
import { lastBalanceSnapshot } from './plaid';
import { torontoToday } from './constants';

const DDL = `
CREATE TABLE IF NOT EXISTS bankroll_entries (
  id serial PRIMARY KEY, entry_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('cash', 'pending')),
  amount numeric(12,2) NOT NULL CHECK (amount <> 0), note text, created_by text,
  created_at timestamptz NOT NULL DEFAULT now(), cleared_at timestamptz, cleared_by text,
  voided_at timestamptz, voided_by text);
CREATE INDEX IF NOT EXISTS idx_bankroll_entries_date ON bankroll_entries (entry_date DESC, id DESC);`;
let ready = false;
async function ensure() { if (ready) return; await query(DDL); ready = true; }

const c2 = (v) => Math.round(Number(v) * 100) / 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const STALE_MINUTES = 120; // a bank figure older than this is shown as old, not as "now"

export async function addEntry({ date, kind, amount, note, by }) {
  await ensure();
  if (!['cash', 'pending'].includes(kind)) throw new Error('Say whether it is cash or money on its way through the bank.');
  const a = c2(amount);
  if (!Number.isFinite(a) || a === 0) throw new Error('Enter an amount.');
  const d = DAY.test(String(date || '')) ? date : torontoToday();
  const { rows } = await query(
    `INSERT INTO bankroll_entries (entry_date, kind, amount, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [d, kind, a, String(note || '').trim().slice(0, 300) || null, by || null]);
  return rows[0].id;
}

// The bank now shows it: it stops being counted here, because the bank figure carries it.
export async function clearEntry(id, by) {
  await ensure();
  const { rowCount } = await query(
    `UPDATE bankroll_entries SET cleared_at = now(), cleared_by = $2
      WHERE id = $1 AND kind = 'pending' AND cleared_at IS NULL AND voided_at IS NULL`, [Number(id), by || null]);
  if (!rowCount) throw new Error('That one is already cleared or voided.');
}

export async function voidEntry(id, by) {
  await ensure();
  const { rowCount } = await query(
    `UPDATE bankroll_entries SET voided_at = now(), voided_by = $2 WHERE id = $1 AND voided_at IS NULL`, [Number(id), by || null]);
  if (!rowCount) throw new Error('That one is already voided.');
}

// Pure: what the bank says is spendable, from a snapshot. A card's balance is what is OWED, so only
// deposit accounts count. `available` already has pending card/debit holds taken off; `current` does not.
export function bankFigure(snapshot) {
  if (!snapshot) return { available: null, current: null, at: null, minutesOld: null, stale: true, accounts: [] };
  const dep = (snapshot.accounts || []).filter((a) => a.type === 'depository');
  const sum = (f) => c2(dep.reduce((t, a) => t + (Number.isFinite(f(a)) ? f(a) : 0), 0));
  const minutesOld = Math.max(0, Math.round((Date.now() - new Date(snapshot.at).getTime()) / 60000));
  return {
    available: sum((a) => (a.available ?? a.current)), current: sum((a) => a.current),
    at: snapshot.at, minutesOld, stale: minutesOld > STALE_MINUTES,
    accounts: dep.map((a) => ({ name: a.name, mask: a.mask, current: a.current, available: a.available }))
  };
}

// Pure: the bankroll itself.
export function bankroll({ bank, cash, pending }) {
  const parts = { bank: bank == null ? 0 : bank, cash: c2(cash || 0), pending: c2(pending || 0) };
  return { ...parts, total: c2(parts.bank + parts.cash + parts.pending), bankKnown: bank != null };
}

// Pure: a "not at the bank yet" entry that the bank feed now seems to show. Matched on the exact amount
// and only on lines from its date onward; it is a HINT with a Clear button, never an automatic clear.
export function looksCleared(entry, bankLines) {
  const want = Math.round(Math.abs(Number(entry.amount)) * 100);
  const outgoing = Number(entry.amount) < 0;
  if (!outgoing) return null; // money in is checked against deposits by hand
  return bankLines.find((l) => l.date >= entry.date && Math.round(l.gross * 100) === want) || null;
}

export async function bankrollSummary(day) {
  if (!hasDb()) return null;
  await ensure();
  const date = DAY.test(String(day || '')) ? day : torontoToday();
  const snapshot = await lastBalanceSnapshot();
  const bank = bankFigure(snapshot);

  const sums = (await query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'cash' AND voided_at IS NULL), 0) AS cash,
            COALESCE(SUM(amount) FILTER (WHERE kind = 'pending' AND voided_at IS NULL AND cleared_at IS NULL), 0) AS pending
       FROM bankroll_entries`)).rows[0];

  const entryRows = (await query(
    `SELECT id, to_char(entry_date,'YYYY-MM-DD') AS date, kind, amount, note, created_by, created_at, cleared_at, voided_at
       FROM bankroll_entries ORDER BY entry_date DESC, id DESC LIMIT 300`)).rows
    .map((r) => ({ id: r.id, date: r.date, kind: r.kind, amount: Number(r.amount), note: r.note, by: r.created_by,
      createdAt: r.created_at, cleared: !!r.cleared_at, voided: !!r.voided_at }));

  // Lines the bank has told us about on or after the oldest open entry, for the "looks cleared" hint.
  const open = entryRows.filter((e) => e.kind === 'pending' && !e.cleared && !e.voided);
  let recent = [];
  if (open.length) {
    const since = open.reduce((m, e) => (e.date < m ? e.date : m), open[0].date);
    recent = (await query(
      `SELECT to_char(incurred_on,'YYYY-MM-DD') AS date, COALESCE(payee_override, vendor) AS who, amount, tax
         FROM expenses WHERE source = 'plaid' AND incurred_on >= $1::date`, [since])).rows
      .map((r) => ({ date: r.date, who: r.who, gross: c2(Number(r.amount) + Number(r.tax || 0)) }));
  }
  for (const e of open) { const hit = looksCleared(e, recent); if (hit) e.bankShows = hit; }

  // The day's sheet: money out the bank reported, e-transfers in, and everything entered by hand.
  const out = (await query(
    `SELECT id, COALESCE(payee_override, vendor) AS who, category, amount, tax FROM expenses
      WHERE source = 'plaid' AND incurred_on = $1::date ORDER BY id`, [date])).rows
    .map((r) => ({ id: r.id, who: r.who, category: r.category, amount: c2(-(Number(r.amount) + Number(r.tax || 0))) }));
  let inn = [];
  try {
    inn = (await query(
      `SELECT id, sender, amount_cents FROM bank_deposits WHERE received_on = $1::date ORDER BY id`, [date])).rows
      .map((r) => ({ id: r.id, who: r.sender, amount: c2(Number(r.amount_cents) / 100) }));
  } catch { /* no deposits table yet: nothing to show */ }
  const mine = entryRows.filter((e) => e.date === date && !e.voided);
  const dayNet = c2([...out, ...inn, ...mine].reduce((t, l) => t + l.amount, 0));

  return {
    date, bank, ...bankroll({ bank: bank.available, cash: Number(sums.cash), pending: Number(sums.pending) }),
    entries: entryRows, day: { out, in: inn, mine, net: dayNet }
  };
}
