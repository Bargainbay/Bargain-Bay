// What we are promoting, and when. NO imports: the banner, the /deals page and
// the tests all read this, and none of them should drag a database in.
//
// WHAT LIVES HERE AND WHAT DELIBERATELY DOES NOT
// This file says which promotion is running and which units to put in front of
// people. It never says what a code is WORTH or what a unit COSTS:
//   · a code's value, minimum, end date and remaining uses are read from the
//     `coupons` table (lib/deals.js), so the page cannot describe a code
//     differently from the way checkout applies it; and
//   · every price shown comes from lib/pricing.js, as everywhere else.
// A deal that needs a code (`needsCode`) is simply not shown until that code is
// live in /admin/coupons. Advertising a code that checkout then refuses is the
// worst thing a promotion page can do.

// Dates are Toronto calendar days, inclusive. `from`/`to` are YYYY-MM-DD;
// `fromTime` ('HH:MM', Toronto) holds a deal back until a time on its first day
// — BOO31 is meant to be a surprise at 5pm, and a coupon's own start is only a
// date, so the secrecy has to live here.
export const DEALS = [
  {
    id: 'hosting',
    title: 'Thanksgiving Hosting Sale',
    blurb: 'Ranges, ovens, cooktops and dishwashers for the biggest cooking weekend of the year.',
    from: '2026-10-05', to: '2026-10-12',
    code: 'HOST75', needsCode: true,
    hero: { headline: 'Thanksgiving hosting, sorted.', sub: 'Ranges, double ovens, cooktops and dishwashers, tested and under retail.' },
    skus: ['RS-0608-069', 'S-ORD115896-025', 'S-ORD115896-026', '7405738040-053', 'S-ORD115896-003', 'S-ORD115896-004', 'S-ORD115896-010']
  },
  {
    id: 'laundry',
    title: 'Laundry Week',
    blurb: 'Dryers, washers and pedestals. Build a pair, or add storage under the one you have.',
    from: '2026-10-13', to: '2026-10-19',
    code: 'LAUNDRY100', needsCode: true,
    hero: { headline: 'Laundry Week.', sub: 'Dryers from $346, washers, matching pairs and pedestals.' },
    skus: ['SS-114238-027', 'RS-0608-046', 'RS-0608-047', 'RS-0608-048', 'RS-0608-026', 'RS-0608-029', 'S-ORD115896-017', 'S-ORD115896-031', 'PS-INV117278-003', 'PS-INV117226-001', '7405738040-057']
  },
  {
    id: 'diwali',
    title: 'Diwali Season Sale',
    blurb: 'A new appliance for the new season. Fridges, ranges and dishwashers, delivered across Durham and the GTA.',
    from: '2026-10-19', to: '2026-11-08',
    code: 'DIWALI150', needsCode: true,
    hero: { headline: 'A new appliance for the new season.', sub: 'Fridges, ranges and dishwashers, delivered across Durham and the GTA.' },
    skus: ['SS-114238-011', 'SS-114239-011', '7405738040-046', 'RS-0608-091', 'SS-114238-013']
  },
  {
    id: 'trade',
    title: 'Trade & Contractor Week',
    blurb: 'Landlord, flipper or contractor? Member pricing on every unit, and several identical units to outfit a building in one trip.',
    from: '2026-10-21', to: '2026-10-25',
    code: null, needsCode: false,
    cta: { label: 'Apply for member pricing', href: '/account' },
    hero: { headline: 'Landlord, flipper or contractor?', sub: 'Member pricing on every unit, and identical units to outfit a building in one trip.', cta: { label: 'Apply for member pricing', href: '/account' } },
    skus: ['SS-117082-015', 'SS-117082-016', 'SS-117082-017', 'PS-INV117299-004', 'PS-INV117299-005', 'PS-INV117299-006', 'RS-0608-046', 'RS-0608-047', 'RS-0608-048']
  },
  {
    id: 'halloween',
    title: '31-Hour Halloween Flash',
    blurb: 'Scary prices, nothing scary inside. Ends at midnight Saturday.',
    from: '2026-10-30', fromTime: '17:00', to: '2026-10-31',
    teaseFrom: '2026-10-29', // not listed under "Coming up" before this day
    code: 'BOO31', needsCode: true,
    hero: { headline: '31 hours. Scary-good prices.', sub: 'Ends at midnight Saturday. Nothing scary inside.' },
    skus: []
  }
];

// One unit a week gets an extra markdown (set in /admin, floor-checked there).
// This only says which unit to feature; the price shown is whatever the
// resolver says today, so a drop that was never set up simply shows its normal
// price rather than a made-up one.
export const DROPS = [
  { from: '2026-10-05', to: '2026-10-12', sku: 'RS-0608-069' },
  { from: '2026-10-13', to: '2026-10-18', sku: 'RS-0608-046' },
  { from: '2026-10-19', to: '2026-10-25', sku: '7405738040-053' },
  { from: '2026-10-26', to: '2026-11-01', sku: 'SS-116480-031' }
];

// The Thanksgiving giveaway. Everything the entry form, the rules and the admin
// draw need to agree on lives here.
export const GIVEAWAY = {
  id: 'thanksgiving-2026',
  title: 'Thanksgiving Freezer Giveaway',
  prize: 'a Frigidaire 7 cu. ft. Garage Ready Convertible Upright Freezer (FFUE0726AW)',
  prizeShort: 'Frigidaire 7 cu. ft. upright freezer',
  retailValue: 449,
  from: '2026-10-05', to: '2026-10-12',
  drawDate: '2026-10-13',
  hero: {
    kicker: 'Giveaway · no purchase necessary',
    headline: 'Win a 7 cu. ft. freezer.',
    sub: 'Thanksgiving is on us. One Frigidaire upright freezer, worth $449, goes to one lucky winner.',
    cta: { label: 'Enter now', href: '/giveaway' },
    // The artwork. The prize is the REAL product photo (background removed), not
    // a generated picture of a freezer: a prize must be shown as it is. Only the
    // backdrop around it is generated.
    bg: '/giveaway/hero-bg.jpg',
    image: '/giveaway/freezer.png',
    imageAlt: 'Frigidaire 7 cu. ft. upright freezer, white',
    badge: { top: 'Worth', main: '$449' }
  }
};

// Bonus entries. One base entry for the form, then these, all optional. The
// total is derived every time it is needed (lib/giveaway) from facts that live
// elsewhere, never stored, so it cannot drift from the account, the consent
// record or the video review it describes.
export const BONUS = { account: 1, newsletter: 1, instagram: 1, video: 3 };

export function ticketsOf(f) {
  return 1
    + (f.has_account ? BONUS.account : 0)
    + (f.newsletter ? BONUS.newsletter : 0)
    + (f.instagram_handle ? BONUS.instagram : 0)
    + (f.video_status === 'approved' ? BONUS.video : 0);
}
export const MAX_TICKETS = 1 + BONUS.account + BONUS.newsletter + BONUS.instagram + BONUS.video;

// ---- time -------------------------------------------------------------------

// Toronto's date and clock for an instant. The server runs on UTC; a promotion
// that ends "Monday" ends Monday in Toronto, not at 8pm Sunday.
export function torontoParts(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function isRunning(deal, now = new Date()) {
  const { date, time } = torontoParts(now);
  if (date < deal.from || date > deal.to) return false;
  if (deal.fromTime && date === deal.from && time < deal.fromTime) return false;
  return true;
}

// Announced but not started. Only the DAY counts: a held-back deal (fromTime)
// on its own start day, before the hour, is neither running nor listed as
// upcoming. It is meant to be a surprise, and a schedule would spoil it. A deal
// with `teaseFrom` stays out of the list until that day.
export function isUpcoming(deal, now = new Date()) {
  const { date } = torontoParts(now);
  if (deal.teaseFrom && date < deal.teaseFrom) return false;
  return date < deal.from;
}

export function dropFor(now = new Date()) {
  const { date } = torontoParts(now);
  return DROPS.find((d) => date >= d.from && date <= d.to) || null;
}

export function giveawayOpen(now = new Date()) {
  const { date } = torontoParts(now);
  return date >= GIVEAWAY.from && date <= GIVEAWAY.to;
}

// "Mon Oct 12" for a YYYY-MM-DD, without letting the browser's zone shift it.
export function dayLabel(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', {
    timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric'
  });
}

// "$75 off orders of $750 or more", from the coupon row itself, so the words on
// the page are the rule checkout applies.
export function describeCoupon(c) {
  const v = Number(c.value) || 0;
  const off = c.kind === 'percent' ? `${v}% off` : `$${v % 1 ? v.toFixed(2) : v} off`;
  const min = Number(c.minSubtotal) || 0;
  return min > 0 ? `${off} orders of $${min % 1 ? min.toFixed(2) : min} or more` : `${off} your order`;
}

// What the site-wide bar says. `snap` is the output of dealsSnapshot().
// Soonest-ending deal first: on a changeover day the one about to lapse is the
// one worth a click. A giveaway rides along as a second link, not a second bar.
export function bannerFor(snap) {
  if (!snap) return null;
  const d = snap.active[0];
  const g = snap.giveaway;
  if (!d && !g) return null;
  let text;
  if (d) {
    text = d.coupon
      ? `${d.title}: ${describeCoupon(d.coupon)} with code ${d.coupon.code}`
      : d.title;
  } else {
    text = `${GIVEAWAY.title}: win a ${GIVEAWAY.prizeShort}`;
  }
  return {
    text,
    href: d ? '/deals' : '/giveaway',
    extra: d && g ? { text: `Win a ${GIVEAWAY.prizeShort}`, href: '/giveaway' } : null
  };
}

// What the homepage's top banner says. A giveaway that is open wins (it has a
// deadline and an action); otherwise the soonest-ending deal, same rule as the
// header bar; otherwise null and the page shows its ordinary "name-brand
// appliances" hero. To feature something new there, give its entry in DEALS a
// `hero` and it appears for exactly the days it runs.
export function heroFor(snap) {
  if (!snap) return null;
  const sec = { label: 'See all deals', href: '/deals' };
  if (snap.giveaway) {
    const g = GIVEAWAY.hero;
    return { kicker: g.kicker, headline: g.headline, sub: g.sub, code: null,
             ends: GIVEAWAY.to, cta: g.cta, secondary: sec,
             bg: g.bg || null, image: g.image || null, imageAlt: g.imageAlt || '', badge: g.badge || null };
  }
  const d = snap.active.find((x) => x.hero);
  if (!d) return null;
  return {
    kicker: d.title,
    headline: d.hero.headline,
    sub: d.hero.sub,
    code: d.coupon ? { code: d.coupon.code, text: describeCoupon(d.coupon) } : null,
    ends: d.coupon?.endsAt || d.to,
    cta: d.hero.cta || { label: 'Shop the deal', href: '/deals' },
    secondary: d.hero.cta ? sec : { label: 'Shop all appliances', href: '/shop' },
    bg: d.hero.bg || null, image: d.hero.image || null, imageAlt: d.hero.imageAlt || '', badge: d.hero.badge || null
  };
}
