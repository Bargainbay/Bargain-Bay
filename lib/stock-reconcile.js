// Keeping the tracker, RS Ops and the sales invoices describing the same stock.
//
// WHY THIS EXISTS (owner, 2026-09-17): 64 of the 114 appliances RS Ops was
// working on were not on the master tracker. Purchase invoices were never
// uploaded, so nothing put the units there; the appliances sold anyway, on
// invoices whose lines were TYPED rather than picked from stock, so nothing was
// ever marked sold either. Three records of one warehouse, none of them right.
//
// Three repairs, one module:
//   1. acceptRsOpsUnits   — anything RS Ops has that the tracker doesn't goes on
//                           the tracker at once, marked NEEDS INVOICE.
//   2. matchInvoiceLines  — when the purchase invoice IS uploaded later, its lines
//      fillWaitingRows      fill those rows in instead of adding the appliances twice.
//   3. unlinkedSaleLines  — sales that name an appliance but carry no stock unit,
//      linkSaleLine         with the likely units, so one tap marks the right one sold.
// Plus the daily report that says what is still waiting, and stockForInvoicing,
// which is what lets the invoice form insist a unit is PICKED rather than typed.
import { hasDb, query, withTransaction } from './db';
import { readTrackerRows, writeTrackerCells, appendTrackerUnits, sheetsConfigured } from './sheets';
import { markUnitsSold } from './catalog-sync';
import { holdInvoiceSkus } from './orders';
import { sendEmail } from './email';
import { SERVICE_EMAIL, money, torontoDate } from './constants';
import { SITE_URL } from './site';
import {
  NEEDS_INVOICE, modelsMatch, modelTokens, isSoldStatus, isWaitingForInvoice,
  invoiceHintFromLot, trackerCategory, normModel
} from './stock-match';

const up = (s) => String(s || '').trim().toUpperCase();
const isSalvage = (status) => /salvage/i.test(String(status || ''));

// A SKU somebody has already sold or is holding. Re-keying a tracker row that an
// invoice line or a reservation points at would move a sale onto a different
// appliance, so any doubt — including an unreadable database — counts as in use.
async function skusInUse(skus) {
  const list = [...new Set((skus || []).map(up).filter(Boolean))];
  if (!list.length || !hasDb()) return new Set(list);
  try {
    const { rows } = await query(
      `SELECT upper(ii.sku) AS sku FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
         WHERE upper(ii.sku) = ANY($1) AND i.status NOT IN ('void')
       UNION
       SELECT upper(sku) FROM reservations WHERE upper(sku) = ANY($1)`,
      [list]
    );
    return new Set(rows.map((r) => r.sku));
  } catch (e) {
    console.error('skusInUse failed — treating all as in use', e?.message || e);
    return new Set(list);
  }
}

// ── 1. RS Ops → tracker ───────────────────────────────────────────────────────
// units: [{ sku, lotId, category, trackerCategory, brand, model, name, serial,
//           createdAt, status }]  (status = RS Ops's word for the tracker)
// rsopsIds: every unit id RS Ops holds. A tracker row whose SKU RS Ops already
//   uses is spoken for and can never be re-keyed onto a different unit.
//
// Per unit, in this order:
//   on-tracker — its SKU is already there. Nothing to do.
//   re-keyed   — the purchase invoice DID reach the tracker, under the SKUs the
//                intake minted (IN-…), for appliances RS Ops booked in by hand
//                under its own. Same invoice number, same model, unclaimed and
//                unsold → that row becomes this unit. This is S-ORD115612 and
//                PS-INV116968, and without it the sweep would add every such
//                appliance a second time.
//   added      — nothing matches: a new row marked NEEDS INVOICE, no cost, off
//                the website (no price, and never Tested Working from here).
export async function acceptRsOpsUnits(units = [], { rsopsIds = [] } = {}) {
  if (!sheetsConfigured()) throw new Error('The tracker is not connected (GOOGLE_CREDENTIALS / SHEET_ID).');
  const list = (Array.isArray(units) ? units : []).filter((u) => u && String(u.sku || '').trim());
  if (!list.length) return { results: [] };
  if (list.length > 200) throw new Error(`${list.length} units in one call — send at most 200.`);

  const rows = await readTrackerRows();
  const bySku = new Map(rows.map((r) => [up(r.sku), r]));
  const claimed = new Set([...rsopsIds, ...list.map((u) => u.sku)].map(up));

  // Rows that could be re-keyed, found up front so the in-use check is one query.
  const candidateRows = (u) => {
    const hint = invoiceHintFromLot(u.lotId);
    if (!hint || !String(u.model || '').trim()) return [];
    return rows.filter((r) => !claimed.has(up(r.sku)) && up(r.invoice).includes(hint)
      && !isWaitingForInvoice(r.invoice) && !isSoldStatus(r.status) && modelsMatch(r.model, u.model));
  };
  const inUse = await skusInUse(list.filter((u) => !bySku.has(up(u.sku))).flatMap((u) => candidateRows(u).map((r) => r.sku)));

  const results = [], cells = [], appends = [], usedRows = new Set();
  const today = torontoDate(new Date());
  for (const u of list) {
    const sku = String(u.sku).trim();
    if (bySku.has(up(sku))) { results.push({ sku, result: 'on-tracker', row: bySku.get(up(sku)).row }); continue; }
    if (!String(u.model || '').trim() && !String(u.serial || '').trim()) {
      results.push({ sku, result: 'skipped', reason: 'no model or serial yet' });
      continue;
    }
    const match = candidateRows(u).find((r) => !usedRows.has(r.row) && !inUse.has(up(r.sku)));
    if (match) {
      usedRows.add(match.row);
      claimed.add(up(match.sku));
      cells.push({ row: match.row, field: 'sku', value: sku });
      if (String(u.serial || '').trim()) cells.push({ row: match.row, field: 'serial', value: String(u.serial).trim() });
      const note = `SKU was ${match.sku} — renamed ${today} to the RS Ops unit booked in by hand`;
      cells.push({ row: match.row, field: 'notes', value: [match.notes, note].filter(Boolean).join(' | ') });
      results.push({ sku, result: 're-keyed', from: match.sku, row: match.row });
      continue;
    }
    const hint = invoiceHintFromLot(u.lotId);
    appends.push({
      lot: String(u.lotId || '').trim() || sku, sku,
      category: trackerCategory(u.category, u.trackerCategory),
      make: String(u.brand || '').trim(), model: String(u.model || '').trim(),
      description: [u.brand, u.name || u.model].filter(Boolean).join(' ').trim(),
      serial: String(u.serial || '').trim() || null,
      invoice: hint ? `${NEEDS_INVOICE} (lot name says ${hint})` : NEEDS_INVOICE,
      dateReceived: torontoDate(u.createdAt) || today,
      status: String(u.status || '').trim() || 'Untested',
      notes: 'Booked in at RS Ops with no purchase invoice on the tracker — cost unknown until the invoice is uploaded'
    });
    results.push({ sku, result: 'added' });
  }

  if (cells.length) await writeTrackerCells(cells);
  if (appends.length) await appendTrackerUnits(appends);
  return {
    results,
    added: results.filter((r) => r.result === 'added').length,
    rekeyed: results.filter((r) => r.result === 're-keyed').length
  };
}

// ── 2. The purchase invoice arrives after the units ──────────────────────────
// For each invoice line, the rows already waiting for an invoice that are the
// same model. A row goes to one line only. Rows whose lot name points at THIS
// invoice number are offered first — they are the most likely to be right.
export async function matchInvoiceLines(lines = [], { invoice = '' } = {}) {
  if (!sheetsConfigured()) return [];
  const waiting = (await readTrackerRows()).filter((r) => isWaitingForInvoice(r.invoice));
  if (!waiting.length) return [];
  const inv = up(invoice).replace(/[^A-Z0-9]/g, '');
  const pointsHere = (r) => inv && up(r.invoice + ' ' + r.lot).replace(/[^A-Z0-9]/g, '').includes(inv);
  // A row whose lot is NAMED after a different invoice (SS-LotPS-INV117036) is
  // that invoice's unit, not this one's, however alike the model — offering it
  // would cost one delivery's fridge at another delivery's price. A bare-number
  // lot (SS-117082) proves nothing: RS Ops numbers some lots its own way.
  const pointsElsewhere = (r) => {
    if (!inv) return false;
    // Invoice-like codes in the lot name: letters AND digits, e.g. INV117036,
    // SERE309113. "SS", "Lot" and a bare number carry no claim either way.
    const codes = up(r.lot).split(/[^A-Z0-9]+/).filter((t) => t.length >= 6 && /[A-Z]/.test(t) && /\d/.test(t));
    return codes.length > 0 && !codes.some((c) => inv.includes(c));
  };
  const used = new Set();
  const out = [];
  (lines || []).forEach((l, line) => {
    if (!String(l?.model || '').trim()) return;
    const qty = Math.max(1, Math.min(50, Math.round(Number(l.qty) || 1)));
    const units = waiting
      .filter((r) => !used.has(r.row) && !pointsElsewhere(r) && modelsMatch(r.model, l.model))
      .sort((a, b) => Number(pointsHere(b)) - Number(pointsHere(a)) || String(a.dateReceived).localeCompare(String(b.dateReceived)))
      .slice(0, qty);
    units.forEach((r) => used.add(r.row));
    if (units.length) {
      out.push({
        line,
        units: units.map((r) => ({ sku: r.sku, lot: r.lot, model: r.model, serial: r.serial, status: r.status, dateReceived: r.dateReceived }))
      });
    }
  });
  return out;
}

// Fill waiting rows from the invoice lines they matched. Re-checked against a
// fresh read: a row that stopped waiting since the review screen loaded, or is
// no longer the line's model, is refused rather than overwritten.
// assignments: [{ line: { cost, retail, model, category, description }, skus: [] }]
export async function fillWaitingRows(assignments = [], { vendor, invoice, lot } = {}) {
  const want = (assignments || []).flatMap((a) => (a.skus || []).map((sku) => ({ sku, line: a.line || {} })));
  if (!want.length) return { filled: [], refused: [] };
  const rows = await readTrackerRows();
  const bySku = new Map(rows.map((r) => [up(r.sku), r]));
  const cells = [], filled = [], refused = [];
  for (const { sku, line } of want) {
    const r = bySku.get(up(sku));
    if (!r || !isWaitingForInvoice(r.invoice)) { refused.push({ sku, reason: 'no longer waiting for an invoice' }); continue; }
    if (!modelsMatch(r.model, line.model)) { refused.push({ sku, reason: `is a ${r.model}, not a ${line.model}` }); continue; }
    const set = (field, value) => { if (value !== undefined && value !== null && value !== '') cells.push({ row: r.row, field, value }); };
    set('cost', line.cost);
    set('retail', line.retail);
    set('vendor', vendor);
    set('invoice', invoice || '');
    set('lot', lot);
    if (!String(r.description || '').trim()) set('description', line.description);
    filled.push(r.sku);
  }
  if (cells.length) await writeTrackerCells(cells);
  return { filled, refused };
}

// ── 3. Sales that never touched stock ────────────────────────────────────────
// Every SKU on a live invoice line, so a unit already sold is never offered twice.
async function skusOnLiveInvoices() {
  const { rows } = await query(
    `SELECT DISTINCT upper(ii.sku) AS sku FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE ii.sku IS NOT NULL AND i.status IN ('open','partial','paid')`
  );
  return new Set(rows.map((r) => r.sku));
}

// Invoice lines that sold an appliance without naming a stock unit:
//   · an appliance line with no SKU (typed, or marked "not from our stock"), and
//   · a SERVICE line whose text names a model we hold — the way round the form.
// Each carries the unsold tracker units of that model, oldest first.
export async function unlinkedSaleLines({ days = 120, stock = null } = {}) {
  if (!hasDb()) return [];
  const { rows: lines } = await query(
    `SELECT ii.id, ii.description, ii.amount, COALESCE(ii.kind,'unit') AS kind, ii.off_stock_reason,
            i.id AS invoice_id, i.number, i.status, i.created_at
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
      WHERE ii.sku IS NULL AND ii.refunded_at IS NULL
        AND COALESCE(ii.kind,'unit') IN ('unit','service')
        AND i.status IN ('open','partial','paid')
        AND COALESCE(i.channel,'manual') <> 'web'
        AND i.created_at >= now() - ($1 || ' days')::interval
      ORDER BY i.created_at DESC, ii.id`,
    [String(Math.max(1, Math.min(730, Number(days) || 120)))]
  ).catch(async (e) => {
    // off_stock_reason arrives with the invoice form change; an older schema reads without it.
    if (!/off_stock_reason/.test(e?.message || '')) throw e;
    return query(
      `SELECT ii.id, ii.description, ii.amount, COALESCE(ii.kind,'unit') AS kind, NULL AS off_stock_reason,
              i.id AS invoice_id, i.number, i.status, i.created_at
         FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
        WHERE ii.sku IS NULL AND ii.refunded_at IS NULL AND COALESCE(ii.kind,'unit') IN ('unit','service')
          AND i.status IN ('open','partial','paid') AND COALESCE(i.channel,'manual') <> 'web'
          AND i.created_at >= now() - ($1 || ' days')::interval
        ORDER BY i.created_at DESC, ii.id`,
      [String(Math.max(1, Math.min(730, Number(days) || 120)))]
    );
  });
  if (!lines.length) return [];

  const tracker = stock || (sheetsConfigured() ? await readTrackerRows().catch(() => []) : []);
  const taken = await skusOnLiveInvoices().catch(() => new Set());
  const available = tracker.filter((r) => !isSoldStatus(r.status) && !isSalvage(r.status) && !taken.has(up(r.sku)));

  const out = [];
  for (const l of lines) {
    const tokens = modelTokens(l.description);
    const candidates = available
      .filter((r) => tokens.some((t) => modelsMatch(t, r.model)))
      .sort((a, b) => String(a.dateReceived).localeCompare(String(b.dateReceived)))
      .slice(0, 8)
      .map((r) => ({ sku: r.sku, lot: r.lot, model: r.model, serial: r.serial, status: r.status,
                     waitingForInvoice: isWaitingForInvoice(r.invoice), dateReceived: r.dateReceived }));
    // A service line only counts when it names something we actually hold —
    // "Delivery" and "Installation" are services and nothing is missing from them.
    if (l.kind === 'service' && !candidates.length) continue;
    out.push({
      itemId: l.id, invoiceId: l.invoice_id, number: l.number, status: l.status,
      date: torontoDate(l.created_at), description: l.description, amount: Number(l.amount) || 0,
      kind: l.kind, offStockReason: l.off_stock_reason || null,
      models: tokens.map(normModel), candidates
    });
  }
  return out;
}

// Point a typed sale line at the stock unit that actually went out. Everything
// downstream then happens the ordinary way: a paid invoice marks the unit sold
// (and the tracker's Sold / price / date via the write-back); an unpaid one holds
// it off the website until the money lands.
export async function linkSaleLine(itemId, sku) {
  if (!hasDb()) throw new Error('Database not configured.');
  const id = Number(itemId);
  const want = String(sku || '').trim();
  if (!id || !want) throw new Error('Pick the line and the unit.');

  const { rows } = await query(
    `SELECT ii.id, ii.description, ii.amount, ii.sku, i.id AS invoice_id, i.number, i.status, i.order_id
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE ii.id = $1`, [id]
  );
  const line = rows[0];
  if (!line) throw new Error('That invoice line no longer exists.');
  if (line.sku) throw new Error(`That line is already linked to ${line.sku}.`);
  if (!['open', 'partial', 'paid'].includes(line.status)) throw new Error(`${line.number} is ${line.status} — a closed invoice can't be changed.`);

  const tracker = await readTrackerRows();
  const unit = tracker.find((r) => up(r.sku) === up(want));
  if (!unit) throw new Error(`${want} is not on the tracker.`);
  if (isSoldStatus(unit.status)) throw new Error(`${unit.sku} is already marked Sold on the tracker.`);
  if ((await skusOnLiveInvoices()).has(up(unit.sku))) throw new Error(`${unit.sku} is already on another invoice.`);

  await withTransaction(async (client) => {
    const r = await client.query(
      `UPDATE invoice_items SET sku = $2, kind = 'unit', warranty_months = COALESCE(warranty_months, 12)
        WHERE id = $1 AND sku IS NULL`, [id, unit.sku]
    );
    if (!r.rowCount) throw new Error('Somebody linked that line a moment ago — reload.');
    if (line.order_id) {
      await client.query(
        `UPDATE order_items SET sku = $2, kind = 'unit'
          WHERE id = (SELECT id FROM order_items WHERE order_id = $1 AND sku IS NULL
                        AND title = $3 AND price = $4 ORDER BY id LIMIT 1)`,
        [line.order_id, unit.sku, line.description, line.amount]
      );
    }
  });

  let stock;
  if (line.status === 'paid') {
    await markUnitsSold([unit.sku], { channel: 'invoice', ref: line.number, prices: { [unit.sku]: Number(line.amount) || null } });
    stock = 'sold';
  } else {
    const contested = line.order_id ? await holdInvoiceSkus(line.order_id, [unit.sku]) : [];
    stock = contested.length ? 'contested' : 'held';
  }
  return { itemId: id, number: line.number, sku: unit.sku, stock };
}

// ── What can be put on an invoice ────────────────────────────────────────────
// Everything on the tracker that isn't sold or salvage — NOT just what is live
// on the website. The picker used to offer only live units, so an appliance
// sold while it was still in cleaning or repair (most of them, for a liquidation
// shop) could not be picked, and the rep typed it instead. That is the whole
// reason sales stopped reaching stock.
let _stockCache = { at: 0, rows: null };
export async function trackerStockCached({ maxAgeMs = 60000 } = {}) {
  if (_stockCache.rows && Date.now() - _stockCache.at < maxAgeMs) return _stockCache.rows;
  const rows = await readTrackerRows();
  _stockCache = { at: Date.now(), rows };
  return rows;
}

export async function stockForInvoicing({ catalog = [] } = {}) {
  const priceOf = new Map((catalog || []).map((u) => [up(u.id), Number(u.price) || 0]));
  const rows = sheetsConfigured() ? await trackerStockCached().catch(() => []) : [];
  const taken = hasDb() ? await skusOnLiveInvoices().catch(() => new Set()) : new Set();
  const out = rows
    .filter((r) => !isSoldStatus(r.status) && !isSalvage(r.status) && !taken.has(up(r.sku)))
    .map((r) => ({
      id: r.sku,
      description: `${r.description || [r.make, r.model].filter(Boolean).join(' ')} (${r.sku})`,
      price: priceOf.get(up(r.sku)) || 0,
      status: r.status || 'Untested',
      model: r.model,
      search: `${r.make} ${r.model} ${r.description} ${r.category} ${r.sku} ${r.serial} ${r.lot}`.toLowerCase()
    }));
  // Live catalogue units the tracker read missed (a stale cache) are still offered.
  const have = new Set(out.map((u) => up(u.id)));
  for (const u of catalog || []) {
    if (have.has(up(u.id)) || taken.has(up(u.id))) continue;
    out.push({
      id: u.id, description: `${u.title || `${u.make} ${u.model}`} (${u.id})`, price: Number(u.price) || 0,
      status: 'Tested Working', model: u.model,
      search: `${u.make || ''} ${u.model || ''} ${u.title || ''} ${u.category || ''} ${u.id || ''}`.toLowerCase()
    });
  }
  return out;
}

// The server half of "an appliance is picked from stock, not typed". Returns a
// message for the first line that breaks the rule, or null. Lines that were
// already on the invoice unchanged are let through — an edit to an old sale
// must not be refused over how it was written before this existed.
export async function stockRuleProblem(items = [], { previous = [] } = {}) {
  // By description only: a tax-in invoice sends typed amounts where the stored
  // ones are pre-tax, and repricing an old typed line is an ordinary correction.
  const same = (a, b) => String(a.description || '').trim().toLowerCase() === String(b.description || '').trim().toLowerCase();
  const wasThere = (it) => (previous || []).some((p) => !p.sku && same(p, it));

  for (const it of items || []) {
    const kind = it.kind || 'unit';
    const desc = String(it.description || '').trim();
    if (!desc || !(Number(it.amount) > 0)) continue;
    if (kind === 'unit' && !String(it.sku || '').trim() && !String(it.offStockReason || '').trim() && !wasThere(it)) {
      return `“${desc}” is an appliance line with no stock unit. Pick it from stock — or, if it genuinely isn't ours, use "Not from our stock?" under the line and say why.`;
    }
  }

  const services = (items || []).filter((it) => it.kind === 'service' && modelTokens(it.description).length && !wasThere(it));
  if (!services.length || !sheetsConfigured()) return null;
  let stock;
  try { stock = await trackerStockCached(); } catch { return null; } // the model check degrades open
  const held = stock.filter((r) => !isSoldStatus(r.status) && !isSalvage(r.status));
  for (const it of services) {
    const hit = held.find((r) => modelTokens(it.description).some((t) => modelsMatch(t, r.model)));
    if (hit) {
      return `“${String(it.description).trim()}” names a ${hit.model}, and we have ${hit.model} in stock. Put it on the invoice as an appliance picked from stock, not as a service.`;
    }
  }
  return null;
}

// ── The daily report ─────────────────────────────────────────────────────────
export async function inventoryGapsReport({ days = 120 } = {}) {
  const tracker = sheetsConfigured() ? await readTrackerRows() : [];
  const waitingRows = tracker.filter((r) => isWaitingForInvoice(r.invoice));
  const lots = new Map();
  for (const r of waitingRows) {
    const key = r.lot || '(no lot)';
    const e = lots.get(key) || { lot: key, hint: invoiceHintFromLot(key), units: [], oldest: r.dateReceived || '' };
    e.units.push({ sku: r.sku, make: r.make, model: r.model, status: r.status, sold: isSoldStatus(r.status), dateReceived: r.dateReceived });
    if (r.dateReceived && (!e.oldest || r.dateReceived < e.oldest)) e.oldest = r.dateReceived;
    lots.set(key, e);
  }
  const unlinked = await unlinkedSaleLines({ days, stock: tracker }).catch((e) => {
    console.error('unlinked sale lines failed', e?.message || e);
    return [];
  });
  return {
    waiting: [...lots.values()].sort((a, b) => String(a.oldest).localeCompare(String(b.oldest))),
    waitingCount: waitingRows.length,
    unlinked,
    generatedAt: new Date().toISOString()
  };
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const daysSince = (d) => (d ? Math.max(0, Math.round((Date.now() - new Date(`${d}T12:00:00`).getTime()) / 86400000)) : null);

export function inventoryGapsEmailHtml(report) {
  const link = `${SITE_URL}/admin/inventory-gaps`;
  const waiting = report.waiting.map((l) => {
    const age = daysSince(l.oldest);
    return `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee"><b>${esc(l.lot)}</b>${l.hint ? `<br><span style="color:#777">lot name says ${esc(l.hint)}</span>` : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${l.units.length}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${age == null ? '—' : `${age} day${age === 1 ? '' : 's'}`}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#555">${esc([...new Set(l.units.map((u) => u.model))].join(', '))}</td></tr>`;
  }).join('');
  const unlinked = report.unlinked.slice(0, 40).map((s) => `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eee"><b>${esc(s.number)}</b><br><span style="color:#777">${esc(s.date)} · ${esc(s.status)}</span></td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(s.description)}${s.offStockReason ? `<br><span style="color:#777">marked not from our stock: ${esc(s.offStockReason)}</span>` : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(s.amount)}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#555">${s.candidates.length ? `${s.candidates.length} possible unit${s.candidates.length === 1 ? '' : 's'}` : 'no matching unit on the tracker'}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:760px">
    <h2 style="margin:0 0 6px">Inventory that doesn't add up</h2>
    <p style="margin:0 0 16px;color:#555">Fix these on <a href="${link}">the inventory gaps page</a> — every row there has the button that fixes it.</p>
    ${report.waiting.length ? `<h3 style="margin:18px 0 6px">${report.waitingCount} unit${report.waitingCount === 1 ? '' : 's'} with no purchase invoice</h3>
      <p style="margin:0 0 8px;color:#555">RS Ops has them, so they're on the tracker — with no cost. Upload each lot's purchase invoice and its lines fill these rows in.</p>
      <table style="border-collapse:collapse;width:100%"><tr style="text-align:left;color:#777"><th style="padding:6px 8px">Lot</th><th style="padding:6px 8px;text-align:right">Units</th><th style="padding:6px 8px;text-align:right">Waiting</th><th style="padding:6px 8px">Models</th></tr>${waiting}</table>` : ''}
    ${report.unlinked.length ? `<h3 style="margin:22px 0 6px">${report.unlinked.length} sale line${report.unlinked.length === 1 ? '' : 's'} not tied to a stock unit</h3>
      <p style="margin:0 0 8px;color:#555">These sold an appliance without saying which one, so it still shows as in stock. Pick the unit that went out.</p>
      <table style="border-collapse:collapse;width:100%"><tr style="text-align:left;color:#777"><th style="padding:6px 8px">Invoice</th><th style="padding:6px 8px">Line</th><th style="padding:6px 8px;text-align:right">Amount</th><th style="padding:6px 8px">Units</th></tr>${unlinked}</table>
      ${report.unlinked.length > 40 ? `<p style="color:#777">…and ${report.unlinked.length - 40} more on the page.</p>` : ''}` : ''}
  </div>`;
}

// ── The scheduled pass ───────────────────────────────────────────────────────
const RSOPS = () => (process.env.RSOPS_BASE_URL || 'https://ops.rssolutions.ca').replace(/\/+$/, '');

async function rsops(path, init = {}) {
  const key = process.env.RSOPS_INTAKE_KEY;
  if (!key) throw new Error('RSOPS_INTAKE_KEY not set');
  const res = await fetch(`${RSOPS()}${path}`, {
    ...init,
    headers: { 'x-rsops-key': key, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(20000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `RS Ops answered ${res.status}`);
  return body;
}

// Pull everything RS Ops holds for our own stock, put the missing units on the
// tracker, tell RS Ops which ones are now linked (so its status changes reach
// the tracker from then on), and — on the schedule — mail the report.
export async function runStockReconcile({ email = false } = {}) {
  const out = { pulled: 0, added: 0, rekeyed: 0, linked: 0, errors: [] };
  try {
    const { units = [], ids = [] } = await rsops('/api/intake/own-units');
    out.pulled = units.length;
    const todo = units.filter((u) => !u.linked);
    for (let i = 0; i < todo.length; i += 150) {
      const batch = todo.slice(i, i + 150);
      const r = await acceptRsOpsUnits(batch, { rsopsIds: ids });
      out.added += r.added;
      out.rekeyed += r.rekeyed;
      const linked = r.results.filter((x) => x.result !== 'skipped').map((x) => x.sku);
      if (linked.length) {
        await rsops('/api/intake/linked', { method: 'POST', body: JSON.stringify({ skus: linked }) })
          .then(() => { out.linked += linked.length; })
          .catch((e) => out.errors.push(`telling RS Ops: ${e.message}`));
      }
    }
  } catch (e) {
    out.errors.push(`RS Ops → tracker: ${e?.message || e}`);
  }

  if (email) {
    try {
      const report = await inventoryGapsReport();
      out.waiting = report.waitingCount;
      out.unlinked = report.unlinked.length;
      if (report.waitingCount || report.unlinked.length || out.errors.length) {
        const parts = [
          report.waitingCount && `${report.waitingCount} unit${report.waitingCount === 1 ? '' : 's'} with no purchase invoice`,
          report.unlinked.length && `${report.unlinked.length} sale${report.unlinked.length === 1 ? '' : 's'} not tied to stock`
        ].filter(Boolean);
        const html = inventoryGapsEmailHtml(report)
          + (out.errors.length ? `<p style="color:#b00;font-family:Arial,sans-serif">The RS Ops check itself failed: ${esc(out.errors.join('; '))}</p>` : '');
        const sent = await sendEmail({ to: SERVICE_EMAIL, subject: `Inventory gaps: ${parts.join(', ') || 'the RS Ops check failed'}`, html });
        out.emailed = !!sent?.ok;
      }
    } catch (e) {
      out.errors.push(`report: ${e?.message || e}`);
    }
  }
  if (out.errors.length) console.error('stock reconcile', JSON.stringify(out.errors));
  return out;
}
