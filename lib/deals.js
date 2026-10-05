// The server half of the promotions: which deals are running RIGHT NOW, with
// their codes checked against the coupons table.
//
// A deal that needs a code is only live while that code is. That is the whole
// point of reading the table rather than trusting lib/deals-config: a typo in a
// code, a coupon nobody has created yet, one that has run out of uses, or one
// switched off in /admin/coupons all simply remove the deal from the site,
// instead of advertising something checkout would refuse.
import { query, hasDb } from './db';
import { ensureCouponSchema } from './coupons';
import { DEALS, isRunning, isUpcoming, giveawayOpen, dropFor } from './deals-config';

// The banner is in every storefront page's header, so this must be cheap and
// must never be the reason a page fails. 30s is also how long an admin who just
// switched a code off waits for the banner to follow.
const TTL_MS = 30_000;
let _cache = { at: 0, byCode: new Map() };

async function liveCoupons() {
  if (!hasDb()) return new Map();
  if (Date.now() - _cache.at < TTL_MS) return _cache.byCode;
  try {
    await ensureCouponSchema();
    const { rows } = await query(`
      SELECT upper(code) AS code, kind, value::float AS value, min_subtotal::float AS min_subtotal,
             to_char(ends_at, 'YYYY-MM-DD') AS ends_at, exclude_clearance
        FROM coupons
       WHERE active
         AND (starts_at IS NULL OR starts_at <= (now() AT TIME ZONE 'America/Toronto')::date)
         AND (ends_at   IS NULL OR ends_at   >= (now() AT TIME ZONE 'America/Toronto')::date)
         AND (max_uses  IS NULL OR used_count < max_uses)`);
    const byCode = new Map(rows.map((r) => [r.code, {
      code: r.code, kind: r.kind, value: r.value, minSubtotal: r.min_subtotal,
      endsAt: r.ends_at, excludeClearance: !!r.exclude_clearance
    }]));
    _cache = { at: Date.now(), byCode };
    return byCode;
  } catch (e) {
    // Keep serving the last good answer through a blip; with none, show no codes.
    console.error('deals: coupon read failed:', e.message);
    return _cache.byCode;
  }
}

export async function dealsSnapshot(now = new Date()) {
  const coupons = await liveCoupons();
  const active = [];
  for (const d of DEALS) {
    if (!isRunning(d, now)) continue;
    const coupon = d.code ? coupons.get(d.code) || null : null;
    if (d.needsCode && !coupon) continue;
    active.push({ ...d, coupon });
  }
  // Soonest-ending first.
  active.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  // The upcoming list never carries a code, a unit or the held-back deal's
  // time: it says that something is coming, not how to get it early.
  const upcoming = DEALS.filter((d) => isUpcoming(d, now))
    .map((d) => ({ id: d.id, title: d.title, blurb: d.blurb, from: d.from, to: d.to }));
  return { active, upcoming, giveaway: giveawayOpen(now), drop: dropFor(now) };
}
