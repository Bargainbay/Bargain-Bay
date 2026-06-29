// Salesperson attribution. The rep list lives in settings (key 'sales_reps');
// orders/quotes carry a free-text sales_rep (self-provisioning columns).
import { query, hasDb } from './db';
import { getSetting, setSetting } from './settings';

let ensured = null;
export async function ensureRepColumns() {
  if (!hasDb()) return;
  if (ensured) return ensured;
  ensured = Promise.all([
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep text'),
    query('ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sales_rep text')
  ]).catch((e) => { ensured = null; throw e; });
  return ensured;
}

export async function listReps() {
  const v = await getSetting('sales_reps', []);
  return Array.isArray(v) ? v.filter(Boolean) : [];
}

export async function setReps(arr) {
  const clean = [...new Set((arr || []).map((s) => String(s).trim()).filter(Boolean))];
  await setSetting('sales_reps', clean);
  return clean;
}

export async function setOrderRep(orderId, rep) {
  if (!hasDb()) return false;
  await ensureRepColumns();
  await query('UPDATE orders SET sales_rep = $2 WHERE id = $1', [orderId, rep ? String(rep).trim() : null]);
  return true;
}
