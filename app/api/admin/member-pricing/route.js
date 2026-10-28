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

export const dynamic = 'force-dynamic';

// Admin only: this decides what every reseller pays and so what we earn on them, and the preview
// shows cost.
async function requireAdmin() {
  const session = await getSession();
  return session && isAdmin(session) ? session : null;
}

const PAGE_SIZE = 50;

// What a rate set does to the shop RIGHT NOW: per unit, through the same function checkout uses.
// Every live unit is in `rows`; the screen shows one page of them (`q` narrows by SKU, brand, model
// or title). The summary always covers the whole shop, not the page.
async function previewFor(rates, overrides, { q = '', page = 1, pageSize = PAGE_SIZE } = {}) {
  const [all, cmap] = await Promise.all([getAll(), clearanceMap()]);
  const live = all.filter((u) => u.active !== false && u.price > 0);
  const floors = await consignmentFloors(live.map((u) => u.id)).catch(() => new Map());
  const run = (u, r) => unitPrices(u, { cl: cmap.get(u.id), floor: floors.get(u.id)?.floor || 0, member: true, rates: r, overrides });
  const cur = await getMemberRates();

  let discounted = 0, atPublic = 0, belowMinProfit = 0, discSum = 0, belowCost = 0;
  const rows = live.map((u) => {
    const now = run(u, cur.rates);
    const next = run(u, rates);
    const cost = Number(u.cost) || 0;
    return { u, now, next, cost };
  });
  for (const { next, u, cost } of rows) {
    if (next.price < next.clientPrice) { discounted++; discSum += 1 - next.price / next.clientPrice; } else atPublic++;
    if (cost > 0 && next.price - cost < rates.minProfit) belowMinProfit++;
    if (cost > 0 && next.price < cost) belowCost++;
  }
  const term = String(q || '').trim().toLowerCase();
  const matched = (term
    ? rows.filter(({ u }) => [u.id, u.make, u.model, u.title, u.category].join(' ').toLowerCase().includes(term))
    : rows
  ).sort((a, b) => String(a.u.title || `${a.u.make} ${a.u.model}`).localeCompare(String(b.u.title || `${b.u.make} ${b.u.model}`)) || String(a.u.id).localeCompare(String(b.u.id)));
  const size = Math.min(100, Math.max(10, Number(pageSize) || PAGE_SIZE));
  const pages = Math.max(1, Math.ceil(matched.length / size));
  const pg = Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1));
  const slice = matched.slice((pg - 1) * size, pg * size);
  return {
    summary: {
      units: rows.length, discounted, atPublic, belowMinProfit, belowCost,
      avgDiscountPct: discounted ? Math.round((discSum / discounted) * 1000) / 10 : 0
    },
    total: matched.length, page: pg, pages, pageSize: size,
    rows: slice.map(({ u, now, next, cost }) => ({
      sku: u.id, title: u.title || `${u.make} ${u.model}`, retail: u.compareAt || null,
      // `listPrice` is what the tracker says; `public` is what the shop charges (a clearance markdown
      // can be lower).
      listPrice: u.price, public: next.clientPrice, onClearance: cmap.has(u.id), cost,
      memberNow: now.price, memberNext: next.price,
      marginNow: cost ? Math.round((now.price - cost) * 100) / 100 : null,
      marginNext: cost ? Math.round((next.price - cost) * 100) / 100 : null,
      override: overrides[u.id] ?? null
    }))
  };
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
      return NextResponse.json({ preview: await previewFor(r.rates, cur.overrides, { q: body.q, page: body.page }) });
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
      const sku = String(body.sku || '').trim();
      const u = await getById(sku).catch(() => null);
      if (!u) return NextResponse.json({ error: `No product with SKU ${sku}.` }, { status: 404 });
      const done = [];
      if ('publicPrice' in body) {
        if (body.publicPrice === null || body.publicPrice === '') {
          const n = await removeClearance(sku);
          if (n) { await audit(session, { action: 'clearance.remove', entity: 'clearance', entityId: sku, summary: 'Public price put back to the tracker price (member pricing screen)' }); done.push('public price back to normal'); }
        } else {
          const price = Math.round(Number(body.publicPrice) * 100) / 100;
          if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: 'Enter a public price greater than zero.' }, { status: 400 });
          if (price > Number(u.price) + 0.005) return NextResponse.json({ error: `${sku} is listed at ${money(u.price)} on the tracker. A price here can only mark it down; to raise it, change its Retail or Condition on the tracker.` }, { status: 400 });
          // Consigned stock can't be marked down under cost + 20% (same rule as /api/admin/clearance).
          const floors = await consignmentFloors([sku]).catch(() => new Map());
          const f = floors.get(sku);
          if (f && f.floor > 0 && price + 0.005 < f.floor) return NextResponse.json({ error: `${sku} is ${f.vendor ? `${f.vendor}'s` : 'a vendor\u2019s'} drop-off stock: we owe ${money(f.cost)} for it when it sells, so it can't go under ${money(f.floor)}.` }, { status: 400 });
          const cl = (await clearanceMap()).get(sku);
          await upsertClearance({ sku, price, warrantyMonths: cl?.warrantyMonths, note: cl?.note });
          await audit(session, { action: 'clearance.set', entity: 'clearance', entityId: sku, summary: `Public price ${money(price)} (member pricing screen)`, detail: { price } });
          done.push(`public price ${money(price)}`);
        }
      }
      if ('member' in body) {
        if (body.member === null || body.member === '') {
          const r = await removeOverride(sku);
          if (r.removed) { await audit(session, { action: 'member_pricing.override_removed', entity: 'member_pricing', entityId: sku, summary: `Member price override for ${sku} removed (was $${r.before})`, detail: { before: r.before } }); done.push('member price back to the rates'); }
        } else {
          const r = await setOverride(sku, body.member);
          if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
          await audit(session, { action: 'member_pricing.override', entity: 'member_pricing', entityId: sku, summary: `Member price for ${sku} set to $${r.price}${r.before != null ? ` (was $${r.before})` : ''}`, detail: { price: r.price, before: r.before } });
          done.push(`member price ${money(r.price)}`);
        }
      }
      const next = await getMemberRates();
      return NextResponse.json({ ok: true, done, preview: await previewFor(next.rates, next.overrides, { q: body.q, page: body.page }) });
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
