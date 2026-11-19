import { NextResponse } from 'next/server';
import { audit } from '../../../../lib/audit';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { getAll, getById } from '../../../../lib/inventory';
import { clearanceMap, upsertClearance, removeClearance } from '../../../../lib/clearance';
import { consignmentFloors } from '../../../../lib/consignment';
import { unitPrices } from '../../../../lib/pricing';
import { getMemberRates, saveMemberRates, setOverride, removeOverride } from '../../../../lib/member-rates';
import { DEFAULT_MEMBER_RATES, MEMBER_RATE_LIMITS, normalizeRates, toPercent } from '../../../../lib/member-rate-rules';
import { money } from '../../../../lib/constants';
import { getListOverrides, setListOverride, removeListOverride } from '../../../../lib/list-price-overrides';
import { BULK_MODES, newPriceFor } from '../../../../lib/price-math';
import { pushPriceToTracker, restoreTrackerPrice } from '../../../../lib/price-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Admin only: this decides what every reseller pays and so what we earn on them, and the preview
// shows cost.
async function requireAdmin() {
  const session = await getSession();
  return session && isAdmin(session) ? session : null;
}

const PAGE_SIZE = 50;

async function buildRows(rates, overrides) {
  const [all, cmap] = await Promise.all([getAll(), clearanceMap()]);
  const live = all.filter((u) => u.active !== false && u.price > 0);
  const floors = await consignmentFloors(live.map((u) => u.id)).catch(() => new Map());
  const run = (u, r) => unitPrices(u, { cl: cmap.get(u.id), floor: floors.get(u.id)?.floor || 0, member: true, rates: r, overrides });
  const cur = await getMemberRates();
  const listOv = await getListOverrides().catch(() => ({}));
  const rows = live.map((u) => ({ u, now: run(u, cur.rates), next: run(u, rates), cost: Number(u.cost) || 0 }));
  return { rows, cmap, listOv };
}

const titleOf = (u) => u.title || `${u.make} ${u.model}`;
const belowCostRow = ({ next, cost }) => cost > 0 && (next.clientPrice + 0.005 < cost || next.price + 0.005 < cost);
const matches = (rows, q, filter) => {
  const term = String(q || '').trim().toLowerCase();
  let out = term ? rows.filter(({ u }) => [u.id, u.make, u.model, u.title, u.category, u.condition].join(' ').toLowerCase().includes(term)) : rows;
  if (filter === 'below') out = out.filter(belowCostRow);
  return out;
};

// What a rate set does to the shop RIGHT NOW: per unit, through the same function checkout uses.
// Every live unit is in `rows`; the screen shows one page of them. `q` narrows by SKU, brand, model,
// title, category or condition; `filter: 'below'` keeps only units priced under cost; `sort` orders them.
async function previewFor(rates, overrides, { q = '', page = 1, pageSize = PAGE_SIZE, filter = '', sort = 'title' } = {}) {
  const { rows, cmap, listOv } = await buildRows(rates, overrides);
  let discounted = 0, atPublic = 0, discSum = 0, belowCost = 0;
  for (const r of rows) {
    if (r.next.price < r.next.clientPrice) { discounted++; discSum += 1 - r.next.price / r.next.clientPrice; } else atPublic++;
    if (belowCostRow(r)) belowCost++;
  }
  const profitOf = (r) => (r.cost ? r.next.clientPrice - r.cost : Infinity);
  const memberProfitOf = (r) => (r.cost ? r.next.price - r.cost : Infinity);
  const byTitle = (a, b) => titleOf(a.u).localeCompare(titleOf(b.u)) || String(a.u.id).localeCompare(String(b.u.id));
  const sorters = {
    title: byTitle,
    profit_low: (a, b) => profitOf(a) - profitOf(b) || byTitle(a, b),
    profit_high: (a, b) => (profitOf(b) === Infinity ? -1 : profitOf(b)) - (profitOf(a) === Infinity ? -1 : profitOf(a)) || byTitle(a, b),
    member_profit_low: (a, b) => memberProfitOf(a) - memberProfitOf(b) || byTitle(a, b),
    price_high: (a, b) => b.next.clientPrice - a.next.clientPrice || byTitle(a, b),
    price_low: (a, b) => a.next.clientPrice - b.next.clientPrice || byTitle(a, b)
  };
  const matched = matches(rows, q, filter).sort(sorters[sort] || byTitle);
  const size = Math.min(100, Math.max(10, Number(pageSize) || PAGE_SIZE));
  const pages = Math.max(1, Math.ceil(matched.length / size));
  const pg = Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1));
  const slice = matched.slice((pg - 1) * size, pg * size);
  return {
    summary: { units: rows.length, discounted, atPublic, belowCost, avgDiscountPct: discounted ? Math.round((discSum / discounted) * 1000) / 10 : 0 },
    total: matched.length, page: pg, pages, pageSize: size,
    rows: slice.map(({ u, now, next, cost }) => ({
      sku: u.id, title: titleOf(u), condition: u.condition || '', category: u.category || '', retail: u.compareAt || null,
      // `listPrice` is what the tracker says; `public` is what the shop charges (a clearance markdown
      // can be lower).
      listPrice: u.price, public: next.clientPrice, onClearance: cmap.has(u.id), cost,
      memberNow: now.price, memberNext: next.price,
      marginNow: cost ? Math.round((now.price - cost) * 100) / 100 : null,
      marginNext: cost ? Math.round((next.price - cost) * 100) / 100 : null,
      override: overrides[u.id] ?? null,
      listOverride: listOv[u.id] ? true : false, trackerPrice: listOv[u.id]?.tracker ?? u.price
    }))
  };
}

async function bulkTargets(body) {
  const cur = await getMemberRates();
  const { rows } = await buildRows(cur.rates, cur.overrides);
  const mode = String(body.mode || ''); const amount = Number(body.amount);
  if (!BULK_MODES.includes(mode) || !Number.isFinite(amount)) return { error: 'Pick how to change the price and enter an amount.' };
  const target = ['public', 'member', 'both'].includes(body.target) ? body.target : 'both';
  const skus = Array.isArray(body.skus) ? new Set(body.skus.map(String)) : null;
  const chosen = skus ? rows.filter(({ u }) => skus.has(String(u.id))) : matches(rows, body.q, body.filter);
  if (chosen.length > 500) return { error: `That is ${chosen.length} units; change at most 500 at a time (narrow it with the search or the below-cost filter).` };
  const out = [];
  for (const r of chosen) {
    const facts = { cost: r.cost, retail: Number(r.u.compareAt) || 0 };
    const change = { sku: r.u.id, title: titleOf(r.u), cost: r.cost, oldPublic: r.now.clientPrice, oldMember: r.now.price };
    if (target !== 'member') change.newPublic = newPriceFor(r.now.clientPrice, facts, mode, amount, body.round);
    if (target !== 'public') change.newMember = newPriceFor(r.now.price, facts, mode, amount, body.round);
    const movesPublic = change.newPublic != null && Math.abs(change.newPublic - r.now.clientPrice) > 0.004;
    const movesMember = change.newMember != null && Math.abs(change.newMember - r.now.price) > 0.004;
    if (movesPublic || movesMember) out.push({ ...change, movesPublic, movesMember });
  }
  return { targets: out, considered: chosen.length };
}

const previewOpts = (b) => ({ q: b.q, page: b.page, filter: b.filter, sort: b.sort });

// One unit, one or both prices. A public price reaches the TRACKER first (lib/price-sync.js) and the
// site second, so a failed sheet write changes nothing and the two never disagree. Member prices have
// no tracker column and live on the site only.
async function applyPrices(session, sku, body) {
  const u = await getById(sku).catch(() => null);
  if (!u) return { error: `No product with SKU ${sku}.`, status: 404 };
  const done = [];
  if ('publicPrice' in body) {
    const lo = await getListOverrides();
    const trackerPrice = lo[sku]?.tracker ?? Number(u.price);
    if (body.publicPrice === null || body.publicPrice === '') {
      try { const t = await restoreTrackerPrice(sku); if (t.restored) done.push('tracker formula restored'); }
      catch (e) { return { error: `The tracker could not be updated (${e.message}). Nothing was changed.`, status: 502 }; }
      const restored = await removeListOverride(sku);
      if (restored != null) { await audit(session, { action: 'list_price.remove', entity: 'list_price', entityId: sku, summary: `List price put back to the tracker price ${money(restored)} (pricing screen)` }); done.push('list price back to the tracker'); }
      const n = await removeClearance(sku);
      if (n) { await audit(session, { action: 'clearance.remove', entity: 'clearance', entityId: sku, summary: 'Public price put back to the tracker price (pricing screen)' }); done.push('public price back to normal'); }
    } else {
      const price = Math.round(Number(body.publicPrice) * 100) / 100;
      if (!Number.isFinite(price) || price <= 0) return { error: 'Enter a public price greater than zero.' };
      // Consigned stock can't be marked down under cost + 20% (same rule as /api/admin/clearance).
      if (price <= trackerPrice + 0.005) {
        const floors = await consignmentFloors([sku]).catch(() => new Map());
        const f = floors.get(sku);
        if (f && f.floor > 0 && price + 0.005 < f.floor) return { error: `${sku} is ${f.vendor ? `${f.vendor}'s` : 'a vendor\u2019s'} drop-off stock: we owe ${money(f.cost)} for it when it sells, so it can't go under ${money(f.floor)}.` };
      }
      try { await pushPriceToTracker(sku, price); }
      catch (e) { return { error: `The tracker could not be updated (${e.message}). Nothing was changed.`, status: 502 }; }
      if (price > trackerPrice + 0.005) {
        // ABOVE the tracker price: a list price that wins over the sheet's formula, not a clearance markdown.
        const r = await setListOverride(sku, price, trackerPrice);
        if (r.error) return { error: r.error };
        await removeClearance(sku);
        await audit(session, { action: 'list_price.set', entity: 'list_price', entityId: sku, summary: `List price for ${sku} set to ${money(price)} over the tracker's ${money(r.tracker)}${r.before != null ? ` (was ${money(r.before)})` : ''}`, detail: { price, tracker: r.tracker, before: r.before } });
        done.push(`public ${money(price)}`);
      } else {
        if (lo[sku]) await removeListOverride(sku); // at or under the tracker price: the override is no longer wanted
        const cl = (await clearanceMap()).get(sku);
        await upsertClearance({ sku, price, warrantyMonths: cl?.warrantyMonths, note: cl?.note });
        await audit(session, { action: 'clearance.set', entity: 'clearance', entityId: sku, summary: `Public price ${money(price)} (pricing screen)`, detail: { price } });
        done.push(`public ${money(price)}`);
      }
    }
  }
  if ('member' in body) {
    if (body.member === null || body.member === '') {
      const r = await removeOverride(sku);
      if (r.removed) { await audit(session, { action: 'member_pricing.override_removed', entity: 'member_pricing', entityId: sku, summary: `Member price override for ${sku} removed (was $${r.before})`, detail: { before: r.before } }); done.push('member price back to the rates'); }
    } else {
      const r = await setOverride(sku, body.member);
      if (r.error) return { error: r.error };
      await audit(session, { action: 'member_pricing.override', entity: 'member_pricing', entityId: sku, summary: `Member price for ${sku} set to $${r.price}${r.before != null ? ` (was $${r.before})` : ''}`, detail: { price: r.price, before: r.before } });
      done.push(`member ${money(r.price)}`);
    }
  }
  return { done };
}

async function overridesWithTitles(overrides) {
  return Promise.all(Object.entries(overrides).map(async ([sku, price]) => {
    const u = await getById(sku).catch(() => null);
    return { sku, price, title: u ? (u.title || `${u.make} ${u.model}`) : null, found: !!u, publicPrice: u?.price ?? null };
  }));
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  const cur = await getMemberRates();
  return NextResponse.json({
    rates: cur.rates, defaults: DEFAULT_MEMBER_RATES, limits: MEMBER_RATE_LIMITS,
    overrides: await overridesWithTitles(cur.overrides),
    preview: await previewFor(cur.rates, cur.overrides, {})
  });
}

// POST { action: 'preview' | 'save_rates' | 'reset_rates' | 'set_override' | 'remove_override' | 'search', ... }
export async function POST(req) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  let body; try { body = await req.json(); } catch { body = {}; }
  try {
    const cur = await getMemberRates();
    if (body.action === 'preview') {
      const r = normalizeRates(body.rates, cur.rates);
      if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json({ preview: await previewFor(r.rates, cur.overrides, previewOpts(body)) });
    }
    if (body.action === 'save_rates' || body.action === 'reset_rates') {
      const input = body.action === 'reset_rates' ? DEFAULT_MEMBER_RATES : body.rates;
      const r = await saveMemberRates(input);
      if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
      const changes = Object.keys(r.rates).filter((k) => r.rates[k] !== r.before[k]).map((k) =>
        k === 'minProfit' ? `${k} $${r.before[k]}→$${r.rates[k]}` : `${k} ${toPercent(r.before[k])}%→${toPercent(r.rates[k])}%`);
      await audit(session, {
        action: body.action === 'reset_rates' ? 'member_pricing.reset' : 'member_pricing.rates',
        entity: 'member_pricing', entityId: 'rates',
        summary: changes.length ? `Member pricing: ${changes.join(', ')}` : 'Member pricing saved (no change)',
        detail: { before: r.before, after: r.rates }
      });
      return NextResponse.json({ ok: true, rates: r.rates, preview: await previewFor(r.rates, cur.overrides, {}) });
    }
    if (body.action === 'set_override') {
      const sku = String(body.sku || '').trim();
      const u = await getById(sku).catch(() => null);
      if (!u) return NextResponse.json({ error: `No product with SKU ${sku}.` }, { status: 404 });
      const r = await setOverride(sku, body.price);
      if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
      await audit(session, { action: 'member_pricing.override', entity: 'member_pricing', entityId: sku,
        summary: `Member price for ${sku} set to $${r.price}${r.before != null ? ` (was $${r.before})` : ''}`, detail: { price: r.price, before: r.before } });
      const next = await getMemberRates();
      return NextResponse.json({ ok: true, overrides: await overridesWithTitles(next.overrides) });
    }
    if (body.action === 'remove_override') {
      const sku = String(body.sku || '').trim();
      const r = await removeOverride(sku);
      if (r.removed) await audit(session, { action: 'member_pricing.override_removed', entity: 'member_pricing', entityId: sku,
        summary: `Member price override for ${sku} removed (was $${r.before})`, detail: { before: r.before } });
      const next = await getMemberRates();
      return NextResponse.json({ ok: true, overrides: await overridesWithTitles(next.overrides) });
    }
    // One unit, both prices, from the table: { sku, member?, publicPrice? }. A number sets it; null puts
    // it back (member -> the rates decide again, public -> the tracker price).
    if (body.action === 'set_prices') {
      const r = await applyPrices(session, String(body.sku || '').trim(), body);
      if (r.error) return NextResponse.json({ error: r.error }, { status: r.status || 400 });
      const next = await getMemberRates();
      return NextResponse.json({ ok: true, done: r.done, preview: await previewFor(next.rates, next.overrides, previewOpts(body)) });
    }
    // Bulk: { skus? | q + filter, target, mode, amount, round, dryRun }. A dry run only reports.
    if (body.action === 'bulk') {
      const t = await bulkTargets(body);
      if (t.error) return NextResponse.json({ error: t.error }, { status: 400 });
      const belowCost = t.targets.filter((x) => x.cost > 0 && ((x.movesPublic && x.newPublic < x.cost) || (x.movesMember && x.newMember < x.cost))).length;
      if (body.dryRun !== false) {
        return NextResponse.json({ ok: true, dryRun: true, considered: t.considered, willChange: t.targets.length, belowCost, sample: t.targets.slice(0, 8) });
      }
      let changed = 0; const failed = [];
      for (const x of t.targets) {
        const patch = {};
        if (x.movesPublic) patch.publicPrice = x.newPublic;
        if (x.movesMember) patch.member = x.newMember;
        const r = await applyPrices(session, x.sku, patch);
        if (r.error) failed.push({ sku: x.sku, error: r.error }); else changed++;
      }
      const next = await getMemberRates();
      return NextResponse.json({ ok: true, changed, failed: failed.slice(0, 20), failedCount: failed.length, preview: await previewFor(next.rates, next.overrides, previewOpts(body)) });
    }
    if (body.action === 'search') {
      const term = String(body.q || '').trim().toLowerCase();
      if (!term) return NextResponse.json({ results: [] });
      const all = await getAll();
      return NextResponse.json({
        results: all.filter((u) => [u.id, u.make, u.model, u.title].join(' ').toLowerCase().includes(term)).slice(0, 15)
          .map((u) => ({ sku: u.id, title: u.title || `${u.make} ${u.model}`, price: u.price, retail: u.compareAt || null }))
      });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
