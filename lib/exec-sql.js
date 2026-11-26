// Money SQL for the General Manager, kept out of lib/exec-data so the definitions
// it shares with the dashboards are in one obvious place.
import { query } from './db';
import { SALE } from './analytics';
import { consignedSkus, preTaxCostSql } from './consignment';

export { SALE };
const TZ = `AT TIME ZONE 'America/Toronto'`;

// Per closing rep per day: pre-tax revenue and gross profit, on the Daily P&L's
// definition (unit lines at price less cost, plus credit lines, less a checkout
// coupon; a unit with no cost counts as zero profit).
export async function preTaxProfitByRep(from, to) {
  const consigned = [...(await consignedSkus())];
  const COST = preTaxCostSql('oi.sku', 'COALESCE(oi.cost, p.cost)', '$3');
  const { rows } = await query(
    `SELECT o.sales_rep AS rep, (o.created_at ${TZ})::date::text AS day,
            COALESCE(sum(o.total - COALESCE(o.hst,0) - COALESCE(o.vendor_subtotal,0)),0)::float AS revenue,
            COALESCE(sum(x.profit - COALESCE(o.discount,0)),0)::float AS profit
       FROM orders o
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(CASE
                  WHEN COALESCE(oi.kind,'unit') = 'unit' AND COALESCE(oi.cost, p.cost) IS NOT NULL THEN oi.price - ${COST}
                  WHEN oi.kind IN ('discount','trade_in') THEN oi.price ELSE 0 END), 0) AS profit
           FROM order_items oi LEFT JOIN products p ON p.sku = oi.sku
          WHERE oi.order_id = o.id AND oi.vendor_id IS NULL) x ON true
      WHERE ${SALE('o')} AND (o.created_at ${TZ})::date BETWEEN $1::date AND $2::date
      GROUP BY 1, 2`, [from, to, consigned]);
  return rows;
}
