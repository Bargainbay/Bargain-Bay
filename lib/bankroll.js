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
  kind text NOT NULL,
  amount numeric(12,2) NOT NULL, note text, created_by text,
  created_at timestamptz NOT NULL DEFAULT now(), cleared_at timestamptz, cleared_by text,
  voided_at timestamptz, voided_by text);
CREATE INDEX IF NOT EXISTS idx_bankroll_entries_date ON bankroll_entries (entry_date DESC, id DESC);
ALTER TABLE bankroll_entries DROP CONSTRAINT IF EXISTS bankroll_entries_kind_check;
ALTER TABLE bankroll_entries DROP CONSTRAINT IF EXISTS bankroll_entries_amount_check;
ALTER TABLE bankroll_entries ADD CONSTRAINT bankroll_entries_kind_check CHECK (kind IN ('cash', 'pending', 'count'));
ALTER TABLE bankroll_entries ADD CONSTRAINT bankroll_entries_amount_check CHECK (kind = 'count' OR amount <> 0);`;
let ready = false;
async function ensure() { if (ready) return; await query(DDL); ready = true; }

const c2 = (v) => Math.round(Number(v) * 100) / 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const STALE_MINUTES = 120; // a bank figure older than this is shown as old, not as "now"

export async function addEntry({ date, kind, amount, note, by }) {
  await ensure();
  if (!['cash', 'pending', 'count'].includes(kind)) throw new Error('Say whether it is cash, a cash count, or money on its way through the bank.');
  const a = c2(amount);
  // A count of nothing is a real answer; everything else needs an amount.
  if (!Number.isFinite(a) || (a === 0 && kind !== 'count') || (kind === 'count' && a < 0)) throw new Error('Enter an amount.');
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
  const parts = { bank: bank == null ? 0 : bank, cash: cash == null ? 0 : c2(cash), pending: c2(pending || 0) };
  return { ...parts, total: c2(parts.bank + parts.cash + parts.pending), bankKnown: bank != null, cashKnown: cash != null };
}

// Pure: cash in the till = the last physical count, plus cash sales taken since, plus any other cash that
// came in, minus cash spent on receipts and cash that went out (paid back, deposited), all since that count.
// With no count there is nothing to build on, so it is UNKNOWN rather than a made-up zero.
export function cashOnHand({ count, sales = 0, other = 0, spent = 0 }) {
  if (count == null) return null;
  return c2(count + sales + other - spent);
}

// Pure: a "not at the bank yet" entry that the bank feed now seems to show. Matched on the exact amount
// and only on lines from its date onward; it is a HINT with a Clear button, never an automatic clear.
export function looksCleared(entry, bankLines) {
  const want = Math.round(Math.abs(Number(entry.amount)) * 100);
  const outgoing = Number(entry.amount) < 0;
  if (!outgoing) return null; // money in is checked against deposits by hand
  return bankLines.find((l) => l.date >= entry.date && Math.round(l.gross * 100) === want) || null;
}

export async function bankrollSummary(day, { days = 7 } = {}) {
  if (!hasDb()) return null;
  await ensure();
  const date = DAY.test(String(day || '')) ? day : torontoToday();
  const snapshot = await lastBalanceSnapshot();
  const bank = bankFigure(snapshot);

  const pend = (await query(
    `SELECT COALESCE(SUM(amount), 0) AS v FROM bankroll_entries
      WHERE kind = 'pending' AND voided_at IS NULL AND cleared_at IS NULL`)).rows[0];

  // Cash: from the last count forward. Cash SALES are already in the system as cash payments on invoices,
  // so nobody types them; what people type is cash spent and the odd cash that came in outside a sale.
  const cnt = (await query(
    `SELECT id, amount, created_at, to_char(entry_date,'YYYY-MM-DD') AS counted_on FROM bankroll_entries WHERE kind = 'count' AND voided_at IS NULL
      ORDER BY created_at DESC, id DESC LIMIT 1`)).rows[0];
  let cashParts = { count: null, sales: 0, other: 0, spent: 0, countedAt: null };
  if (cnt) {
    // Compared inside the database against the count's own timestamp: a Date round-trip loses microseconds and
    // can put a payment taken a moment AFTER the count on the wrong side of it.
    const since = cnt.id;
    // A count dated BEFORE the day it was entered is that day's closing figure ("yesterday's till was $1,970"), so
    // everything from the start of the next day on is added to it; a count made today is the till right now.
    const AFTER = `(SELECT CASE WHEN entry_date < (created_at AT TIME ZONE 'America/Toronto')::date
                                THEN ((entry_date + 1)::timestamp AT TIME ZONE 'America/Toronto') ELSE created_at END
                      FROM bankroll_entries WHERE id = $1)`;
    const [sales, other, spent] = await Promise.all([
      query(`SELECT COALESCE(SUM(amount), 0) AS v FROM invoice_payments WHERE lower(method) = 'cash' AND paid_at > ${AFTER}`, [since]).then((r) => r.rows[0].v).catch(() => 0),
      query(`SELECT COALESCE(SUM(amount), 0) AS v FROM bankroll_entries WHERE kind = 'cash' AND voided_at IS NULL AND created_at > ${AFTER}`, [since]).then((r) => r.rows[0].v),
      query(`SELECT COALESCE(SUM(amount + COALESCE(tax, 0)), 0) AS v FROM expenses WHERE source = 'cash' AND created_at > ${AFTER}`, [since]).then((r) => r.rows[0].v)
    ]);
    cashParts = { count: Number(cnt.amount), sales: c2(sales), other: c2(other), spent: c2(spent), countedAt: cnt.created_at, countedOn: cnt.counted_on };
  }
  const cash = cashOnHand(cashParts);
  const recv = (await query(
    `SELECT COALESCE(SUM(total) FILTER (WHERE reimburse_status = 'owed'), 0) AS owed,
            COUNT(*) FILTER (WHERE reimburse_status = 'owed')::int AS owed_n,
            COUNT(*) FILTER (WHERE paid_with = 'bank' AND expense_id IS NULL)::int AS waiting
       FROM receipts WHERE voided_at IS NULL`).catch(() => ({ rows: [{ owed: 0, owed_n: 0, waiting: 0 }] }))).rows[0];

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
  const mine = entryRows.filter((e) => e.date === date && !e.voided && e.kind !== 'count');
  // Cash spent on receipts that day, and cash sales taken that day.
  const cashOut = (await query(
    `SELECT id, vendor AS who, category, amount, tax FROM expenses WHERE source = 'cash' AND incurred_on = $1::date ORDER BY id`, [date])).rows
    .map((r) => ({ id: r.id, who: r.who, category: r.category, amount: c2(-(Number(r.amount) + Number(r.tax || 0))) }));
  const cashIn = (await query(
    `SELECT id, amount, note FROM invoice_payments WHERE lower(method) = 'cash' AND (paid_at AT TIME ZONE 'America/Toronto')::date = $1::date ORDER BY id`, [date]).catch(() => ({ rows: [] }))).rows
    .map((r) => ({ id: r.id, who: r.note || 'Cash sale', amount: c2(Number(r.amount)) }));
  const dayNet = c2([...out, ...inn, ...mine, ...cashOut, ...cashIn].reduce((t, l) => t + l.amount, 0));

  const live = await liveTransactions(Math.min(Math.max(Number(days) || 7, 1), 60));

  return {
    live, days: Math.min(Math.max(Number(days) || 7, 1), 60),
    date, bankInfo: bank, cashParts, ...bankroll({ bank: bank.available, cash, pending: Number(pend.v) }),
    owed: { amount: c2(recv.owed), count: recv.owed_n }, waitingForBank: recv.waiting,
    entries: entryRows, day: { out, in: inn, mine, cashOut, cashIn, net: dayNet }
  };
}

// The recent ledger: every movement from every source, newest first, in one list. Bank lines come from the
// feed (all money out, e-transfers in); cash lines from cash sales, cash receipts and what people entered.
const safe0 = async (sql) => { try { return (await query(sql)).rows; } catch { return []; } };
async function liveTransactions(days) {
  const since = `((now() AT TIME ZONE 'America/Toronto')::date - ${Number(days) - 1})`;
  const rows = [];
  const add = (r) => rows.push(r);
  const inPay = new Set((await safe0(`SELECT expense_id FROM pay_ledger WHERE expense_id IS NOT NULL AND voided_at IS NULL`)).map((r) => r.expense_id));
  const safe = async (sql) => { try { return (await query(sql)).rows; } catch { return []; } };

  for (const r of await safe(`SELECT id, to_char(incurred_on,'YYYY-MM-DD') AS d, COALESCE(payee_override, vendor) AS who, category, amount, tax, source
      FROM expenses WHERE incurred_on >= ${since} AND source IN ('plaid','cash','personal') ORDER BY incurred_on DESC, id DESC LIMIT 400`)) {
    const gross = c2(Number(r.amount) + Number(r.tax || 0));
    if (r.source === 'plaid') add({ key: `x${r.id}`, date: r.d, tag: 'Bank out', who: r.who, category: r.category, amount: -gross, expenseId: r.id, inPayroll: inPay.has(r.id), order: 1 });
    else if (r.source === 'cash') add({ key: `x${r.id}`, date: r.d, tag: 'Cash out', who: r.who, category: r.category, amount: -gross, order: 2 });
    else add({ key: `x${r.id}`, date: r.d, tag: 'Own pocket', who: r.who, category: r.category, amount: -gross, order: 5, noMoney: true });
  }
  for (const r of await safe(`SELECT id, to_char(received_on,'YYYY-MM-DD') AS d, sender, amount_cents FROM bank_deposits WHERE received_on >= ${since} ORDER BY received_on DESC, id DESC LIMIT 200`)) {
    add({ key: `d${r.id}`, date: r.d, tag: 'Bank in', who: r.sender, amount: c2(Number(r.amount_cents) / 100), order: 0 });
  }
  for (const r of await safe(`SELECT id, to_char((paid_at AT TIME ZONE 'America/Toronto')::date,'YYYY-MM-DD') AS d, amount, note FROM invoice_payments
      WHERE lower(method) = 'cash' AND (paid_at AT TIME ZONE 'America/Toronto')::date >= ${since} ORDER BY paid_at DESC LIMIT 200`)) {
    add({ key: `p${r.id}`, date: r.d, tag: 'Cash sale', who: r.note || 'Cash sale', amount: c2(Number(r.amount)), order: 3 });
  }
  for (const r of await safe(`SELECT id, to_char(entry_date,'YYYY-MM-DD') AS d, kind, amount, note FROM bankroll_entries
      WHERE entry_date >= ${since} AND voided_at IS NULL ORDER BY entry_date DESC, id DESC LIMIT 200`)) {
    const tag = r.kind === 'count' ? 'Till count' : r.kind === 'cash' ? 'Cash' : 'Through the bank';
    add({ key: `b${r.id}`, date: r.d, tag, who: r.note, amount: c2(Number(r.amount)), order: 4, noMoney: r.kind === 'count' });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.order - b.order || String(b.key).localeCompare(String(a.key))));
}
