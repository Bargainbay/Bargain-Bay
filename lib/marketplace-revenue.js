// What the marketplace earns US, as opposed to what passes through us. See docs/marketplace/PLAN.md §8.
//
// A seller is the seller of record; we are the agent. So a seller's item prices (and the HST on them)
// are not revenue — they are owed to the seller, and every revenue figure subtracts them (orders carry
// `vendor_subtotal` / `vendor_hst`, migration 0020). What IS revenue is our commission and our fees,
// recognised when the sale is settled (delivery), which is when vendor_ledger records them.
//
// GMV — the value of what sellers sold — is reported on its own so nobody mistakes it for revenue.
import { query, hasDb } from './db';

const TZ = "AT TIME ZONE 'America/Toronto'";
const LT = (col) => `(${col} ${TZ})`;
const dollars = (cents) => Math.round(Number(cents || 0)) / 100;

const ZERO = { commission: 0, fees: 0, hstOnFees: 0, revenue: 0, gmv: 0, orders: 0 };

/**
 * Between two SQL timestamp expressions (the same strings lib/pnl and lib/analytics build their windows from).
 * Soft-fails to zeros: a missing marketplace table must never break the dashboards that call this.
 */
export async function marketplaceRevenueBetween(fromSql, toSql) {
  if (!hasDb()) return ZERO;
  try {
    const { rows } = await query(
      `SELECT COALESCE(-SUM(amount_cents) FILTER (WHERE kind = 'commission'), 0)                              AS commission,
              COALESCE(-SUM(amount_cents) FILTER (WHERE kind IN ('delivery_service_fee','insurance')), 0)     AS fees,
              COALESCE(-SUM(amount_cents) FILTER (WHERE kind = 'hst_on_fees'), 0)                             AS hst_on_fees,
              COALESCE(SUM(amount_cents)  FILTER (WHERE kind IN ('sale','lane_c_delivery')), 0)               AS gmv,
              COUNT(DISTINCT order_ref)   FILTER (WHERE kind = 'sale')                                        AS orders
         FROM vendor_ledger
        WHERE ${LT('at')} >= ${fromSql} AND ${LT('at')} < ${toSql}`);
    const r = rows[0] || {};
    const commission = dollars(r.commission), fees = dollars(r.fees);
    return {
      commission, fees, hstOnFees: dollars(r.hst_on_fees), revenue: Math.round((commission + fees) * 100) / 100,
      gmv: dollars(r.gmv), orders: Number(r.orders || 0)
    };
  } catch (e) {
    console.error('marketplace revenue read failed', e?.message || e);
    return ZERO;
  }
}
