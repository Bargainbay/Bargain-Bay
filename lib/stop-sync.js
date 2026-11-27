// Keeping a delivery stop's items in step with the sale after the stop was made.
//
// A stop copies the order's appliances once, when it is created. Without this an
// appliance added to the invoice afterwards never reached the driver's loading
// checklist, and one taken off stayed on it.
//
// IT APPLIES THE CHANGE, NOT THE WHOLE ORDER. A caller reads the cargo before it
// changes the sale (`stopCargo`) and hands that back afterwards
// (`syncStopItems`). Only what the change added or removed moves, so a line the
// office typed onto a stop by hand, a sale split across two stops, and the ticks
// on everything else are all left alone.
//
// Only delivery stops still to be done (a failed one included: it gets rebooked).
// A finished stop is a record. Never throws: a stop list is not worth losing an
// invoice edit or a refund over.
import { hasDb, query } from './db';
import { isUnitLine } from './constants';
import { skuFromDescription } from './stock-match';

const up = (s) => String(s || '').trim().toUpperCase();
const norm = (s) => String(s || '').trim().toLowerCase().slice(0, 300);
const keyOf = (line) => (line.sku ? `S:${up(line.sku)}` : `T:${norm(line.title)}`);

const CANCELLED_MARK = '[SALE CANCELLED — do not deliver, check with the office]';
const offMark = (description) => `[TAKE OFF THE VAN — no longer on this sale: ${description}]`;

/** What an order currently puts on a van, or null if it can't be read. */
export async function stopCargo(orderId) {
  if (!hasDb() || !orderId) return null;
  try {
    const { rows } = await query(
      `SELECT o.status, oi.sku, oi.title, oi.kind
         FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.id = $1 ORDER BY oi.id`, [orderId]);
    if (!rows.length) return null;
    const cancelled = ['cancelled', 'refunded'].includes(rows[0].status);
    const lines = cancelled ? [] : rows
      // A line with neither a SKU nor a kind is a refund adjustment or a
      // restocking fee, not something to load.
      .filter((r) => (r.title || r.sku) && (r.sku || r.kind) && isUnitLine(r.kind))
      .map((r) => ({ sku: String(r.sku || '').trim(), title: r.title || r.sku }));
    return { cancelled, lines };
  } catch (e) {
    console.error('stop cargo read failed', e?.message || e);
    return null;
  }
}

// The lines in `a` that `b` does not account for, counting repeats.
function minus(a, b) {
  const left = new Map();
  for (const l of b) left.set(keyOf(l), (left.get(keyOf(l)) || 0) + 1);
  return a.filter((l) => {
    const n = left.get(keyOf(l)) || 0;
    if (n > 0) { left.set(keyOf(l), n - 1); return false; }
    return true;
  });
}

// Is this stop item the appliance on that line? By SKU; a typed line by its text.
function matches(item, line) {
  const sku = up(item.sku || skuFromDescription(item.description));
  if (line.sku) return sku === up(line.sku) || (!sku && norm(item.description) === norm(line.title));
  return !sku && norm(item.description) === norm(line.title);
}

export async function syncStopItems(orderId, before) {
  const none = { changed: 0 };
  if (!before) return none;
  try {
    const after = await stopCargo(orderId);
    if (!after) return none;
    const removed = minus(before.lines, after.lines);
    const added = minus(after.lines, before.lines);
    const retitled = after.lines.flatMap((l) => {
      const was = l.sku && before.lines.find((b) => up(b.sku) === up(l.sku));
      return was && was.title !== l.title ? [{ sku: l.sku, from: was.title, to: l.title }] : [];
    });
    const flipped = before.cancelled !== after.cancelled;
    if (!removed.length && !added.length && !retitled.length && !flipped) return none;

    const any = await query("SELECT 1 FROM jobs WHERE order_id = $1 AND type = 'delivery' LIMIT 1", [orderId]);
    if (!any.rows.length) return none;
    await (await import('./jobs')).ensureJobSchema();

    const { rows: open } = await query(
      `SELECT id, notes FROM jobs
        WHERE order_id = $1 AND type = 'delivery' AND status NOT IN ('done','cancelled')
          AND NOT ('return_pickup' = ANY(COALESCE(services, '{}')))
        ORDER BY (status = 'failed'), job_date NULLS LAST, id`, [orderId]);
    if (!open.length) return none;
    const openIds = new Set(open.map((j) => j.id));

    // Every item on every stop of this order: a unit already on one (delivered,
    // or split onto a second stop) must not be added again.
    let items = (await query(
      `SELECT i.id, i.job_id, i.description, i.sku, i.delivered, j.status AS job_status,
              (i.loaded_at IS NOT NULL AND i.loaded_for IS NOT DISTINCT FROM j.job_date) AS on_van
         FROM job_items i JOIN jobs j ON j.id = i.job_id
        WHERE j.order_id = $1 AND j.status <> 'cancelled' ORDER BY i.id`, [orderId])).rows;

    const log = new Map(open.map((j) => [j.id, { added: [], removed: [], mark: [], unmark: [] }]));
    const lost = [];    // stops something came off: a swapped unit goes back onto the same one

    const drop = async (item) => {
      await query('DELETE FROM job_items WHERE id = $1', [item.id]);
      items = items.filter((i) => i.id !== item.id);
      log.get(item.job_id).removed.push(item.description);
    };
    for (const line of removed) {
      const hit = items.find((i) => openIds.has(i.job_id) && matches(i, line));
      if (hit) {
        await drop(hit);
        lost.push(hit.job_id);
        // Only a specific unit already loaded is worth an instruction. A typed
        // line that was reworded is the same appliance.
        if (line.sku && hit.on_van) log.get(hit.job_id).mark.push(offMark(hit.description));
      }
      // The stop's edit form splits on commas, so an older stop can hold one
      // line in pieces.
      const pieces = String(line.title).split(',').map(norm).filter(Boolean);
      if (pieces.length > 1) {
        for (const i of items.filter((x) => openIds.has(x.job_id) && !x.sku && pieces.includes(norm(x.description)))) {
          await drop(i);
        }
      }
    }

    for (const line of added) {
      const wanted = after.lines.filter((l) => keyOf(l) === keyOf(line)).length;
      const have = items.filter((i) => !(i.job_status === 'done' && i.delivered === false) && matches(i, line)).length;
      if (have >= wanted) continue;
      const jobId = lost.length ? lost.shift() : open[0].id;
      const { rows } = await query(
        'INSERT INTO job_items (job_id, description, sku, qty) VALUES ($1,$2,$3,1) RETURNING id',
        [jobId, line.title, line.sku || null]);
      items.push({ id: rows[0].id, job_id: jobId, description: line.title, sku: line.sku || null });
      log.get(jobId).added.push(line.title);
      // Back on the sale: withdraw any "take it off" said about it.
      for (const j of open) log.get(j.id).unmark.push(offMark(line.title));
    }

    for (const r of retitled) {
      await query(
        'UPDATE job_items SET description = $3 WHERE job_id = ANY($1) AND upper(sku) = $2 AND description = $4',
        [[...openIds], up(r.sku), r.to, r.from]);
    }

    let changed = 0;
    for (const j of open) {
      const l = log.get(j.id);
      let notes = String(j.notes || '');
      for (const mark of [...l.unmark, ...(flipped && !after.cancelled ? [CANCELLED_MARK] : [])]) {
        notes = notes.split(mark).join('');
      }
      const say = [...(flipped && after.cancelled ? [CANCELLED_MARK] : []), ...l.mark].filter((m) => !notes.includes(m));
      notes = [...say, notes].join(' ').replace(/ {2,}/g, ' ').trim();
      if (notes !== String(j.notes || '')) await query('UPDATE jobs SET notes = $2 WHERE id = $1', [j.id, notes || null]);
      const detail = [
        flipped && after.cancelled ? 'Sale cancelled' : '',
        l.added.length ? `Added: ${l.added.join('; ')}` : '',
        l.removed.length ? `Removed: ${l.removed.join('; ')}` : ''
      ].filter(Boolean).join('. ');
      if (!detail) continue;
      await query('INSERT INTO job_events (job_id, event, detail, by_name) VALUES ($1,$2,$3,$4)',
        [j.id, 'items_synced', `Sale changed — ${detail}`.slice(0, 900), 'system']);
      changed += 1;
    }
    return { changed };
  } catch (e) {
    console.error('stop items sync failed', orderId, e?.message || e);
    return none;
  }
}
