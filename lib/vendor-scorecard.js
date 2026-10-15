// A vendor's order scorecard: how they are doing against the standards in PLAN.md §12.1.
// Read-only, computed from the order and claim rows on every load (nothing is stored, so it cannot
// drift from the records it describes). Judged on SERVER timestamps, like the strikes.
//
// A rate is null — never 0 or 100 — when there is nothing to measure. "No orders yet" and "every
// order late" are different facts, and a scorecard that shows 100% for a vendor with no orders is a
// scorecard that has stopped meaning anything.
import { query } from './db';
import { VENDOR_CANCEL_REASONS } from './marketplace-rules';

export const SCORECARD_DAYS = 90;
const n = (v) => Number(v ?? 0);
const hrs = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);

/** numerator / denominator as a whole percent, or null when there is no denominator. */
export const pct = (num, den) => (den > 0 ? Math.round((num / den) * 100) : null);

export async function vendorScorecard(vendorId, { now = new Date(), days = SCORECARD_DAYS } = {}) {
  const since = new Date(now.getTime() - days * 86400000).toISOString();
  const nowIso = new Date(now).toISOString();
  const vendorCodes = Object.keys(VENDOR_CANCEL_REASONS);
  const { rows: [o] } = await query(
    `SELECT
       count(*) FILTER (WHERE confirmed_at IS NOT NULL)::int                                       AS total,
       -- "decided": accepted, or the 24 hours are up. Still-open orders inside their window are not judged yet.
       count(*) FILTER (WHERE accepted_at IS NOT NULL OR (confirmed_at IS NOT NULL AND accept_by < $3))::int AS accept_decided,
       count(*) FILTER (WHERE accepted_at IS NOT NULL AND accepted_at <= accept_by)::int           AS accept_ontime,
       count(*) FILTER (WHERE ready_at IS NOT NULL OR (accepted_at IS NOT NULL AND ready_by < $3))::int AS ready_decided,
       count(*) FILTER (WHERE ready_at IS NOT NULL AND ready_at <= ready_by)::int                  AS ready_ontime,
       count(*) FILTER (WHERE status = 'cancelled' AND cancel_code = ANY($4))::int                 AS vendor_cancelled,
       count(*) FILTER (WHERE status = 'cancelled' AND cancel_code = 'accept_timeout')::int        AS lapsed,
       count(*) FILTER (WHERE status = 'delivered')::int                                           AS delivered,
       count(*) FILTER (WHERE mismatch_at IS NOT NULL AND mismatch_resolution IS DISTINCT FROM 'dismiss')::int AS not_as_described,
       avg(EXTRACT(EPOCH FROM (accepted_at - confirmed_at)) / 3600) FILTER (WHERE accepted_at IS NOT NULL) AS avg_accept_h,
       avg(EXTRACT(EPOCH FROM (ready_at - confirmed_at)) / 3600)    FILTER (WHERE ready_at IS NOT NULL)    AS avg_ready_h
       FROM vendor_orders
      WHERE vendor_id = $1 AND confirmed_at IS NOT NULL AND confirmed_at >= $2`, [vendorId, since, nowIso, vendorCodes]);
  let c = { total: 0, decided: 0, ontime: 0 };
  try {
    const { rows: [w] } = await query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE vendor_responded_at IS NOT NULL OR respond_by < $3)::int AS decided,
              count(*) FILTER (WHERE vendor_responded_at IS NOT NULL AND vendor_responded_at <= respond_by)::int AS ontime
         FROM warranty_claims WHERE vendor_id = $1 AND opened_at >= $2`, [vendorId, since, nowIso]);
    c = { total: n(w.total), decided: n(w.decided), ontime: n(w.ontime) };
  } catch { /* claims table not there: no claims to score */ }
  return {
    days,
    orders: n(o.total), delivered: n(o.delivered),
    acceptedOnTimePct: pct(n(o.accept_ontime), n(o.accept_decided)),
    readyOnTimePct: pct(n(o.ready_ontime), n(o.ready_decided)),
    acceptDecided: n(o.accept_decided), readyDecided: n(o.ready_decided),
    vendorCancelled: n(o.vendor_cancelled), lapsed: n(o.lapsed),
    cancelRatePct: pct(n(o.vendor_cancelled) + n(o.lapsed), n(o.total)),
    notAsDescribed: n(o.not_as_described),
    avgAcceptHours: hrs(o.avg_accept_h), avgReadyHours: hrs(o.avg_ready_h),
    claims: c.total, claimsRespondedOnTimePct: pct(c.ontime, c.decided)
  };
}
