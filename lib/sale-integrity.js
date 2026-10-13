// Two promises, checked against the tracker itself rather than assumed:
//
//   1. If an invoice has had ANY money paid against it, every unit on it says
//      Sold on the tracker and is off the website. Never Available, Untested or
//      Waiting on parts. (owner, 2026-10-13)
//   2. Every sold unit has a cost. A sale with no cost reads as pure profit, so it
//      is filled from the tracker the moment the tracker has it, and the owner is
//      TOLD the moment it can't be.
//
// The payment paths mark units sold the instant money is recorded, but "the
// write went through" is exactly what has been wrong before: a tracker write is
// best-effort, RS Ops writes statuses into the same sheet, and a failure there
// used to be a line in a log nobody reads. So this runs on a schedule, READS the
// tracker, fixes any difference, reads it again to prove the fix, and sends the
// remainder to the owner. Silence from this job means the books and the sheet
// agree.
import { query, hasDb } from './db';
import { readTrackerRows, sheetsConfigured, writebackEnabled } from './sheets';
import { markUnitsSold } from './catalog-sync';
import { missingCostLines, applyMissingCostFill } from './cost-audit';
import { SERVICE_EMAIL } from './constants';
import { sendEmail } from './email';
import { getSetting, setSetting } from './settings';
import { pingOwner } from './work-presence';
import { isMarketplaceSku } from './marketplace-storefront';

const up = (s) => String(s || '').trim().toUpperCase();
const isSold = (s) => /^sold$/i.test(String(s || '').trim());
const money = (v) => `$${Number(v || 0).toFixed(2)}`;

// The cost a tracker row states, the way the rest of the system counts it:
// Total Cost, else Cost of Product. Empty or text means unknown, never zero.
const rowCost = (r) => {
  for (const cell of [r.totalCost, r.cost]) {
    const s = String(cell ?? '').trim();
    if (/\d/.test(s)) {
      const n = Number(s.replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100;
    }
  }
  return null;
};

/**
 * Run the check. Everything external is injectable so it can be tested.
 * Returns { fixed, costsFilled, problems: [{ kind, text }] }.
 */
export async function checkSaleIntegrity({
  readRows = readTrackerRows, sell = markUnitsSold, fillCosts = true,
  writeback = writebackEnabled, configured = sheetsConfigured
} = {}) {
  if (!hasDb()) return { skipped: 'no database', problems: [] };
  const problems = [];
  const out = { fixed: [], costsFilled: 0, problems };

  // ── 1. Money in => Sold ────────────────────────────────────────────────────
  // "Money in" is any payment, or a settled invoice. A line refunded on its own
  // has come back and is not held to this.
  const { rows: lines } = await query(
    `SELECT ii.id, ii.sku, ii.description, ii.amount, i.number, i.status
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE COALESCE(ii.kind,'unit') = 'unit' AND ii.refunded_at IS NULL
        AND i.status IN ('partial','paid')
        AND (i.status = 'paid' OR EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id = i.id AND p.amount > 0))`);

  for (const l of lines.filter((x) => !x.sku)) {
    problems.push({ kind: 'noUnit', text: `${l.number}: “${String(l.description || '').slice(0, 50)}” has money paid but is not tied to a unit, so nothing can be marked Sold. Link it on Stock gaps.` });
  }
  const bySku = new Map();
  for (const l of lines.filter((x) => x.sku && !isMarketplaceSku(x.sku))) bySku.set(up(l.sku), l);

  // The site side: anything still listed on the storefront.
  const { rows: listed } = bySku.size
    ? await query('SELECT sku FROM products WHERE active = true AND sku = ANY($1)', [[...bySku.values()].map((l) => l.sku)])
    : { rows: [] };
  const stillListed = new Set(listed.map((r) => up(r.sku)));

  if (bySku.size) {
    if (!configured()) {
      problems.push({ kind: 'noTracker', text: 'The master tracker is not connected, so units with money paid cannot be checked or marked Sold.' });
    } else {
      try {
        const status = new Map((await readRows()).map((r) => [up(r.sku), r.status]));
        const toFix = new Map();
        for (const [sku, l] of bySku) {
          if (!status.has(sku)) problems.push({ kind: 'notOnTracker', text: `${l.number}: ${l.sku} has money paid but is not on the tracker at all.` });
          else if (!isSold(status.get(sku))) toFix.set(sku, { sku: l.sku, was: status.get(sku) || 'blank', l });
        }
        for (const s of stillListed) if (!toFix.has(s)) toFix.set(s, { sku: bySku.get(s).sku, was: 'listed on the website', l: bySku.get(s) });

        if (toFix.size) {
          if (!writeback()) {
            for (const w of toFix.values()) problems.push({ kind: 'writebackOff', text: `${w.l.number}: ${w.sku} has money paid but the tracker says “${w.was}”, and tracker write-back is OFF so it cannot be fixed automatically.` });
          } else {
            const prices = Object.fromEntries([...toFix.values()].map((w) => [w.sku, Number(w.l.amount) || null]));
            await sell([...toFix.values()].map((w) => w.sku), { channel: 'invoice', ref: 'integrity-check', prices });
            // Prove it: read the sheet again rather than trusting the write.
            const after = new Map((await readRows()).map((r) => [up(r.sku), r.status]));
            for (const w of toFix.values()) {
              if (isSold(after.get(up(w.sku)))) out.fixed.push({ sku: w.sku, invoice: w.l.number, was: w.was });
              else problems.push({ kind: 'stillNotSold', text: `${w.l.number}: ${w.sku} has money paid, the tracker said “${w.was}”, and it STILL does after trying to mark it Sold.` });
            }
          }
        }
      } catch (e) {
        problems.push({ kind: 'trackerRead', text: `Could not read or write the tracker (${e?.message || 'error'}), so units with money paid were not verified this run.` });
      }
    }
  }

  // ── 2. Every sold unit has a cost ──────────────────────────────────────────
  // First take it from the tracker wherever the tracker now has one (a freshly
  // booked-in row's cost formula often fills in a beat late). Whatever is left
  // needs a person, and that is reported, never left to be found later.
  if (fillCosts && configured()) {
    try {
      const costs = new Map();
      for (const r of await readRows()) { const c = rowCost(r); if (c != null) costs.set(up(r.sku), c); }
      const m = await missingCostLines({ read: async () => costs });
      if (m.lines.length) out.costsFilled = (await applyMissingCostFill({ lineIds: m.lines.map((x) => x.id), read: async () => costs })).invoiceLines;
    } catch { /* tracker unreadable: the list below still reports what has no cost */ }
  }
  const { rows: noCost } = await query(
    `SELECT i.number, ii.sku, ii.description, ii.amount
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       LEFT JOIN products p ON p.sku = ii.sku
      WHERE COALESCE(ii.kind,'unit') = 'unit' AND ii.refunded_at IS NULL
        AND i.status IN ('open','partial','paid')
        AND ii.cost IS NULL AND (p.sku IS NULL OR p.cost IS NULL)
      ORDER BY i.created_at DESC LIMIT 100`);
  for (const l of noCost) {
    problems.push({ kind: 'noCost', text: `${l.number}: ${l.sku || String(l.description || '').slice(0, 40)} (sold at ${money(l.amount)}) has NO COST on file. Type it in on Fix missing costs.` });
  }
  return out;
}

/** The scheduled pass: check, then tell the owner about anything left. */
export async function runSaleIntegrity(opts = {}) {
  const r = await checkSaleIntegrity(opts);
  if (!r.problems?.length) return { ...r, notified: false };
  // The same list is not re-sent every run: a new or changed problem goes out at
  // once, an unchanged one is repeated at most every 12 hours until it is fixed.
  const key = r.problems.map((p) => p.text).sort().join('|');
  let notified = false;
  try {
    const last = JSON.parse((await getSetting('sale_integrity_last', '')) || 'null');
    const stale = !last || last.key !== key || Date.now() - Number(last.at || 0) > 12 * 3600 * 1000;
    if (stale) {
      const lines = r.problems.slice(0, 40).map((p) => `• ${p.text}`).join('\n');
      await sendEmail({
        to: SERVICE_EMAIL, subject: `⚠ ${r.problems.length} sold item${r.problems.length === 1 ? '' : 's'} need attention`,
        html: `<p>These sales do not match the books or the tracker:</p><pre style="font:14px/1.5 sans-serif;white-space:pre-wrap">${lines.replace(/</g, '&lt;')}</pre>`
      }).catch(() => {});
      await pingOwner(`⚠️ ${r.problems.length} sold item${r.problems.length === 1 ? '' : 's'} need attention (sold but not marked Sold, or sold with no cost). Details are in the email to ${SERVICE_EMAIL}.`).catch(() => {});
      await setSetting('sale_integrity_last', JSON.stringify({ key, at: Date.now() }));
      notified = true;
    }
  } catch { /* a failed alert must not hide the result */ }
  return { ...r, notified };
}
