// The posting kit and the nightly take-down list for a partner's lead generators (phase 5).
//
// A generator posts our stock on THEIR OWN Facebook (we cannot and do not touch Facebook). Two things have to be true for that to be
// safe: they post accurate words at the public price, and they take a listing down when the unit sells. This module is the second
// half: it records what each generator posted, notices when it stops being for sale, and tells them every evening.
//
// Rules that must hold (each has a test in test/partner-posting.test.mjs):
//   · "GONE" MEANS SOLD, DELISTED, OR HELD FOR A CUSTOMER. A 30-minute card-checkout hold does NOT count (`goneSkus`): it would tell
//     twenty people to delete a listing every time somebody opened checkout. A hold that lasts longer than a checkout (an e-transfer
//     order, an invoice, a rep's hold) IS a customer committing, so it counts.
//   · IF WE CANNOT READ STOCK PROPERLY, WE SAY NOTHING. A failed read, an empty one, or one under half of last night's snapshot would
//     make every posted unit look sold and send everybody a false "take these down". `readStock` refuses, and nothing is emailed.
//   · THE TAKE-DOWN LIST IS THE GENERATOR'S OWN: units THEY marked posted that are no longer for sale. Not four hundred others.
//   · NEW MEANS "NOT ON SALE AT LAST NIGHT'S SNAPSHOT". `products` has no arrival date (every sync rewrites synced_at), so a nightly
//     SKU-set snapshot is compared. With no earlier snapshot nothing is flagged new (the first night is a baseline, not a flood).
//   · PUBLIC PRICES ONLY. Units are decorated with NO session, so a member, clearance floor or cost can never reach a generator.
//   · THE EMAIL CANNOT GO TWICE, AND A MISSING EMAIL IS NOT SWALLOWED: each recipient's row for the day is claimed before sending; a
//     send that fails or is skipped (staging, no mail key) gives the claim back so the next run retries.
import { hasDb, query } from './db';
import { getAll } from './inventory';
import { decorate } from './pricing';
import { fbListing, fbTitle } from './fb-kit';
import { torontoToday } from './constants';
import { sendEmail, esc } from './email';
import { SITE_URL } from './site';
import { RESERVATION_MINUTES } from './reservations';

export class PostingError extends Error { constructor(m, code = 'invalid') { super(m); this.code = code; } }
const norm = (e) => String(e || '').trim().toLowerCase();

let ensured = null;
export function ensurePostingSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!ensured) {
    ensured = query(`
      CREATE TABLE IF NOT EXISTS affiliate_posts (
        id serial PRIMARY KEY, partner_email text NOT NULL, member_email text NOT NULL, sku text NOT NULL,
        posted_at timestamptz NOT NULL DEFAULT now(), gone_at timestamptz, taken_down_at timestamptz, UNIQUE (member_email, sku)
      );
      CREATE INDEX IF NOT EXISTS idx_affiliate_posts_partner ON affiliate_posts (partner_email);
      CREATE TABLE IF NOT EXISTS stock_daily (day date PRIMARY KEY, skus text[] NOT NULL DEFAULT '{}', n integer NOT NULL DEFAULT 0, taken_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE IF NOT EXISTS partner_digests (member_email text NOT NULL, day date NOT NULL, kind text NOT NULL, sent_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (member_email, day));
    `).catch((e) => { ensured = null; throw e; });
  }
  return ensured;
}

// ---- what is for sale right now ------------------------------------------------------------------------------------------
/** SKUs that are sold, or held for a customer for longer than a card checkout takes. */
export async function goneSkus() {
  const { rows } = await query(
    `SELECT DISTINCT oi.sku FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status NOT IN ('cancelled','pending_payment','refunded') AND oi.sku IS NOT NULL AND oi.sku NOT LIKE 'VS-%'
     UNION
     SELECT sku FROM reservations WHERE expires_at > now() + interval '${RESERVATION_MINUTES + 5} minutes'`);
  return new Set(rows.map((r) => r.sku));
}

async function lastSnapshot(beforeDay) {
  const { rows } = await query(`SELECT day::text AS day, skus, n FROM stock_daily WHERE day < $1::date ORDER BY day DESC LIMIT 1`, [beforeDay]);
  return rows[0] || null;
}

/**
 * Our own stock that is for sale now: { ok, units, skus }. `ok: false` (with a reason) when the read cannot be trusted: it failed, it
 * is empty, or it is under half of last night's snapshot. Nobody should be told anything from an untrusted read.
 */
export async function readStock() {
  if (!hasDb()) return { ok: false, reason: 'no database', units: [], skus: new Set() };
  try {
    await ensurePostingSchema();
    const all = await getAll({ strict: true });
    const gone = await goneSkus();
    const units = all.filter((u) => !gone.has(u.id));
    const snap = await lastSnapshot('9999-12-31');
    if (!units.length) return { ok: false, reason: 'empty', units: [], skus: new Set() };
    if (snap && snap.n > 0 && units.length < snap.n * 0.5) return { ok: false, reason: 'far below last night', units: [], skus: new Set() };
    return { ok: true, units, skus: new Set(units.map((u) => u.id)) };
  } catch (e) { return { ok: false, reason: String(e?.message || e), units: [], skus: new Set() }; }
}

/** SKUs for sale now that were not at the last snapshot taken before today. With no earlier snapshot: none (a baseline). */
export async function newSinceLastNight(skus) {
  const prev = await lastSnapshot(torontoToday());
  if (!prev) return [];
  const had = new Set(prev.skus);
  return [...skus].filter((s) => !had.has(s));
}

export async function recordStockSnapshot(skus) {
  const list = [...skus];
  await query(
    `INSERT INTO stock_daily (day, skus, n) VALUES ($1::date, $2, $3)
     ON CONFLICT (day) DO UPDATE SET skus = EXCLUDED.skus, n = EXCLUDED.n, taken_at = now()`, [torontoToday(), list, list.length]);
}

// ---- who posted what -----------------------------------------------------------------------------------------------------
async function codeFor(seat) {
  if (seat.role === 'affiliate') {
    const m = (await query(`SELECT code FROM partner_members WHERE member_email = $1 AND removed_at IS NULL`, [seat.email])).rows[0];
    return { code: m?.code || null, pct: seat.customerPct || 0 };
  }
  const r = (await query(`SELECT c.code FROM referral_partners p LEFT JOIN coupons c ON c.id = p.customer_coupon_id WHERE p.email = $1`, [seat.org])).rows[0];
  return { code: r?.code || null, pct: seat.customerPct || 0 };
}

/** Keep gone_at honest for a set of posts: set it the first time a posted unit is seen gone, clear it if the unit came back. */
async function refreshGone(where, params, skus) {
  await query(`UPDATE affiliate_posts SET gone_at = COALESCE(gone_at, now()) WHERE ${where} AND taken_down_at IS NULL AND NOT (sku = ANY($${params.length + 1}))`, [...params, [...skus]]);
  await query(`UPDATE affiliate_posts SET gone_at = NULL WHERE ${where} AND taken_down_at IS NULL AND gone_at IS NOT NULL AND sku = ANY($${params.length + 1})`, [...params, [...skus]]);
}

async function titlesFor(skus) {
  if (!skus.length) return new Map();
  const { rows } = await query(`SELECT sku, COALESCE(NULLIF(title, ''), trim(coalesce(make,'') || ' ' || coalesce(model,''))) AS t FROM products WHERE sku = ANY($1)`, [skus]);
  return new Map(rows.map((r) => [r.sku, r.t || r.sku]));
}

// A short shared cache of the stock read and its public pricing, so twenty generators opening the kit in the same minute cost about
// one read, not twenty. ONLY the screen uses it: setPosted and the nightly digest always read fresh, so nothing that decides what is
// "gone" or what may be posted is ever up to a minute old. A failed or untrusted read is never cached. Off under the test stubs.
const STOCK_CACHE_MS = process.env.BB_TEST_STUBS ? 0 : 60 * 1000;
let stockCache = null;
async function stockForScreen() {
  if (STOCK_CACHE_MS && stockCache && Date.now() - stockCache.at < STOCK_CACHE_MS) return stockCache.value;
  const stock = await readStock();
  if (!stock.ok) return { stock, units: [] };
  const value = { stock, units: await decorate(stock.units) };     // NO session on purpose: public prices only
  if (STOCK_CACHE_MS) stockCache = { at: Date.now(), value };
  return value;
}

/** Everything the posting screen needs for one login. Never throws a stock problem at the person: it says so in the result. */
export async function postingView(seat) {
  if (!seat) throw new PostingError('Not signed in as a partner.', 'noseat');
  await ensurePostingSchema();
  const { stock, units } = await stockForScreen();
  const posts = (await query(`SELECT sku, posted_at, gone_at, taken_down_at FROM affiliate_posts WHERE member_email = $1`, [seat.email])).rows;
  const posted = {};
  for (const p of posts) if (!p.taken_down_at) posted[p.sku] = p.posted_at;
  if (!stock.ok) return { stockOk: false, asOf: new Date().toISOString(), listings: [], posted, takeDown: [], newCount: 0 };

  await refreshGone('member_email = $1', [seat.email], stock.skus);
  const gone = (await query(`SELECT sku, gone_at FROM affiliate_posts WHERE member_email = $1 AND taken_down_at IS NULL AND gone_at IS NOT NULL ORDER BY gone_at`, [seat.email])).rows;
  const titles = await titlesFor(gone.map((g) => g.sku));
  const fresh = new Set(await newSinceLastNight(stock.skus));
  const partner = await codeFor(seat);
  const listings = units
    .map((u) => ({ ...fbListing(u, partner.code ? partner : null), isNew: fresh.has(u.id) }))
    .sort((a, b) => (b.isNew - a.isNew) || (a.category || '').localeCompare(b.category || '') || a.title.localeCompare(b.title));
  return {
    stockOk: true, asOf: new Date().toISOString(), listings, posted, newCount: fresh.size,
    takeDown: gone.map((g) => ({ sku: g.sku, title: titles.get(g.sku) || g.sku, goneAt: g.gone_at }))
  };
}

/** "I posted this" / "not posted after all" / "I took it down". The SKU comes from the screen; it is checked, never trusted. */
export async function setPosted(seat, sku, action) {
  if (!seat) throw new PostingError('Not signed in as a partner.', 'noseat');
  await ensurePostingSchema();
  const s = String(sku || '').trim();
  if (!s || s.length > 80) throw new PostingError('Pick an item.');
  if (action === 'posted') {
    const stock = await readStock();
    if (!stock.ok) throw new PostingError('We cannot check the stock right now. Please try again in a few minutes.', 'stock');
    if (!stock.skus.has(s)) throw new PostingError('That item is no longer for sale, so it should not be posted.', 'gone');
    await query(
      `INSERT INTO affiliate_posts (partner_email, member_email, sku) VALUES ($1,$2,$3)
       ON CONFLICT (member_email, sku) DO UPDATE SET posted_at = now(), gone_at = NULL, taken_down_at = NULL`, [seat.org, seat.email, s]);
    return { ok: true };
  }
  if (action === 'unposted') {
    await query(`DELETE FROM affiliate_posts WHERE member_email = $1 AND sku = $2`, [seat.email, s]);
    return { ok: true };
  }
  if (action === 'taken_down') {
    const r = await query(`UPDATE affiliate_posts SET taken_down_at = now() WHERE member_email = $1 AND sku = $2 AND taken_down_at IS NULL RETURNING id`, [seat.email, s]);
    if (!r.rows[0]) throw new PostingError('That one is not on your list.', 'notfound');
    return { ok: true };
  }
  throw new PostingError('Unknown action.');
}

/** What the organisation's admins see per generator: listings up, listings still up that have sold, and how many are late (over a day). */
export async function postingCounts(org) {
  await ensurePostingSchema();
  const { rows } = await query(
    `SELECT lower(member_email) AS m,
            COUNT(*) FILTER (WHERE taken_down_at IS NULL AND gone_at IS NULL)::int AS up,
            COUNT(*) FILTER (WHERE taken_down_at IS NULL AND gone_at IS NOT NULL)::int AS to_take_down,
            COUNT(*) FILTER (WHERE taken_down_at IS NULL AND gone_at < now() - interval '1 day')::int AS late
       FROM affiliate_posts WHERE partner_email = $1 GROUP BY 1`, [norm(org)]);
  return new Map(rows.map((r) => [r.m, { up: r.up, toTakeDown: r.to_take_down, late: r.late }]));
}

// ---- the nightly email ---------------------------------------------------------------------------------------------------
const frame = (inner) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2e2d2b">${inner}
  <p style="font-size:12px;color:#777;margin-top:24px">Stock changes during the day. Check the page before you post, and take a sold item down the same night.</p></div>`;
const list = (items, more) => `<ul style="padding-left:18px">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${more > 0 ? `<p>…and ${more} more.</p>` : ''}`;

async function claim(member, day, kind) {
  const r = await query(`INSERT INTO partner_digests (member_email, day, kind) VALUES ($1,$2::date,$3) ON CONFLICT DO NOTHING RETURNING member_email`, [member, day, kind]);
  return !!r.rows[0];
}
const unclaim = (member, day) => query(`DELETE FROM partner_digests WHERE member_email = $1 AND day = $2::date`, [member, day]).catch(() => {});

async function deliver(member, day, kind, subject, html) {
  if (!(await claim(member, day, kind))) return 'already';
  let r;
  try { r = await sendEmail({ to: member, subject, html }); } catch { r = { ok: false }; }
  if (!r || r.ok === false) { await unclaim(member, day); return r?.skipped ? 'skipped' : 'failed'; }
  return 'sent';
}

/**
 * The evening pass: refresh what has sold, email every generator their take-down list and the new items, email each organisation's
 * admins a roll-up, then record tonight's snapshot. Returns counts. Safe to run twice (the second run only retries what failed).
 */
export async function runPostingDigest({ dryRun = false } = {}) {
  if (!hasDb()) return { ok: false, reason: 'no database', sent: 0 };
  await ensurePostingSchema();
  const stock = await readStock();
  if (!stock.ok) return { ok: false, reason: `stock not trusted (${stock.reason}); nothing was sent`, sent: 0 };
  const day = torontoToday();
  const fresh = await newSinceLastNight(stock.skus);
  await refreshGone('TRUE', [], stock.skus);

  const freshUnits = stock.units.filter((u) => fresh.includes(u.id));
  const freshTitles = freshUnits.slice(0, 12).map((u) => fbTitle(u));
  const gens = (await query(
    `SELECT m.member_email, m.name, m.partner_email, p.name AS org FROM partner_members m JOIN referral_partners p ON p.email = m.partner_email
      WHERE m.role = 'affiliate' AND m.removed_at IS NULL AND p.revoked_at IS NULL`)).rows;
  const open = (await query(`SELECT member_email, partner_email, sku FROM affiliate_posts WHERE taken_down_at IS NULL AND gone_at IS NOT NULL`)).rows;
  const titles = await titlesFor([...new Set(open.map((o) => o.sku))]);
  const out = { ok: true, sent: 0, skipped: 0, failed: 0, already: 0, new: fresh.length, dryRun };

  const tally = (r) => { if (r === 'sent') out.sent += 1; else if (r === 'skipped') out.skipped += 1; else if (r === 'failed') out.failed += 1; else out.already += 1; };

  for (const g of gens) {
    const mine = open.filter((o) => norm(o.member_email) === norm(g.member_email)).map((o) => `${titles.get(o.sku) || o.sku} (${o.sku})`);
    if (!mine.length && !fresh.length) continue;
    const first = String(g.name || '').split(' ')[0] || 'there';
    const html = frame(
      `<h2 style="text-transform:uppercase;letter-spacing:.05em">Tonight, ${esc(first)}</h2>`
      + (mine.length ? `<p><b>Take these down tonight.</b> You posted them and they are no longer for sale:</p>${list(mine.slice(0, 20), mine.length - 20)}` : '')
      + (fresh.length ? `<p><b>${fresh.length} new item${fresh.length === 1 ? '' : 's'}</b> since last night:</p>${list(freshTitles, fresh.length - freshTitles.length)}` : '')
      + `<p><a href="${SITE_URL}/partner">Open your posting kit</a></p>`);
    const subject = mine.length ? `Take ${mine.length} listing${mine.length === 1 ? '' : 's'} down tonight` : `${fresh.length} new item${fresh.length === 1 ? '' : 's'} to post`;
    if (dryRun) { out.sent += 1; continue; }
    tally(await deliver(g.member_email, day, 'generator', subject, html));
  }

  // The organisation's admins: who still has sold listings up.
  const orgs = [...new Set(gens.map((g) => g.partner_email))];
  for (const org of orgs) {
    const rows = gens.filter((g) => g.partner_email === org).map((g) => ({ name: g.name || g.member_email, n: open.filter((o) => norm(o.member_email) === norm(g.member_email)).length })).filter((r) => r.n > 0);
    if (!rows.length && !fresh.length) continue;
    const admins = (await query(`SELECT $1::text AS e UNION SELECT member_email FROM partner_members WHERE partner_email = $1 AND role = 'admin' AND removed_at IS NULL`, [org])).rows.map((r) => r.e);
    const html = frame(
      `<h2 style="text-transform:uppercase;letter-spacing:.05em">Your team tonight</h2>`
      + (rows.length ? `<p><b>Still posted but sold:</b></p>${list(rows.map((r) => `${r.name}: ${r.n} listing${r.n === 1 ? '' : 's'}`), 0)}` : '<p>Nobody has a sold listing still up.</p>')
      + `<p>${fresh.length} new item${fresh.length === 1 ? '' : 's'} since last night.</p><p><a href="${SITE_URL}/partner">Open your portal</a></p>`);
    const subject = rows.length ? `Team: ${rows.reduce((a, r) => a + r.n, 0)} sold listing${rows.reduce((a, r) => a + r.n, 0) === 1 ? '' : 's'} still up` : `Team: ${fresh.length} new item${fresh.length === 1 ? '' : 's'}`;
    for (const a of admins) { if (dryRun) { out.sent += 1; continue; } tally(await deliver(a, day, 'roll-up', subject, html)); }
  }

  if (!dryRun) await recordStockSnapshot(stock.skus);
  return out;
}
