// lib/manager-growth.js — the Manager's growth view: sales queue, lost demand, listing quality, pricing watch.
import fs from 'node:fs';
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import {
  scoreLead, scoreCart, buildSalesQueue, summarizeDemand, matchesWanted, listingProblems,
  summarizeListings, pricingFlags, salesQueue, lostDemand, listingQuality, pricingWatch, buildGrowthBrief, GROWTH_CHECKS
} from '../lib/manager-growth.js';

suite('Manager growth view');

const NOW = Date.parse('2026-11-20T15:00:00Z');
const lead = (o = {}) => ({ id: 1, company: 'Acme', source: 'phone', temperature: 'cold', est_value: 0, first_touch_at: new Date(NOW - 3600_000), age_hours: 2, overdue: false, owner_email: 'a@b.ca', created_at: new Date(NOW - 2 * 3600_000), ...o });

test('a hot, untouched, valuable lead outranks a cold one that was already called', () => {
  const hot = scoreLead(lead({ temperature: 'hot', est_value: 3000, first_touch_at: null, age_hours: 30 }), { now: NOW });
  const cold = scoreLead(lead(), { now: NOW });
  assert(hot.score > cold.score + 40, `hot ${hot.score} cold ${cold.score}`);
  assert(/nobody has contacted/.test(hot.why) && /waiting 1 day/.test(hot.why));
});

test('a lead over two weeks old is marked down, and the score stays between 0 and 100', () => {
  const old = scoreLead(lead({ age_hours: 20 * 24, temperature: 'hot' }), { now: NOW });
  const fresh = scoreLead(lead({ age_hours: 2, temperature: 'hot' }), { now: NOW });
  assert(old.score < fresh.score);
  const max = scoreLead(lead({ temperature: 'hot', est_value: 999999, first_touch_at: null, age_hours: 99, overdue: true, owner_email: null }), { now: NOW });
  assert(max.score <= 100 && max.score >= 0);
});

test('a cart with nothing still for sale scores zero and never reaches the queue', () => {
  const dead = { id: 5, availableCount: 0, availableTotal: 0, ageHours: 10, units: [] };
  equal(scoreCart(dead).score, 0);
  const q = buildSalesQueue({ carts: [dead], leads: [] });
  equal(q.length, 0);
});

test('the queue merges leads and carts, highest first, and respects the limit', () => {
  const cart = { id: 9, name: 'Sam', email: 's@x.ca', availableCount: 1, availableTotal: 1800, ageHours: 12, units: [{ title: 'LG fridge', state: 'available' }] };
  const q = buildSalesQueue({
    leads: [lead({ id: 1, temperature: 'hot', first_touch_at: null, age_hours: 30 }), lead({ id: 2 })],
    carts: [cart], limit: 2, now: NOW
  });
  equal(q.length, 2);
  assert(q[0].score >= q[1].score);
  assert(q.some((i) => i.kind === 'cart') || q.every((i) => i.kind === 'lead'));
});

test('lost demand groups by what was wanted and sets it against what is in stock now', () => {
  const rows = [
    { wanted: 'Samsung 30in range', wanted_category: 'range' }, { wanted: 'GE range', wanted_category: 'range' },
    { wanted: 'LG washer', wanted_category: 'washer' }, { wanted: null, wanted_category: null }
  ];
  const units = [{ category: 'Refrigerator', title: 'LG French Door Refrigerator' }, { category: 'Range', title: 'Frigidaire Gas Range' }];
  const d = summarizeDemand(rows, units);
  equal(d[0].key, 'range'); equal(d[0].asked, 2); equal(d[0].inStockNow, 1);
  const washer = d.find((x) => x.key === 'washer');
  equal(washer.inStockNow, 0);
  assert(d.find((x) => x.key === 'unrecorded').inStockNow === null, 'unrecorded has no stock comparison');
  assert(matchesWanted('refrigerator', 'Counter-depth Fridge') && !matchesWanted('washer', 'Dishwasher'), 'washer must not match dishwasher');
});

test('listing problems name what is wrong with a unit', () => {
  const bad = listingProblems({ price: 0, model: '', category: 'Appliance', title: 'LG', condition: '', cost: 0 });
  for (const k of ['no_price', 'no_model', 'vague_category', 'thin_title', 'no_condition', 'no_cost']) assert(bad.includes(k), k);
  const good = listingProblems({ price: 900, compare_at: 1500, model: 'LRFXS2503S', category: 'Refrigerator', title: 'LG 25 cu ft French Door Refrigerator', condition: 'Refurbished', cost: 500 });
  equal(good.length, 0);
  assert(listingProblems({ price: 2000, compare_at: 1500, model: 'X1', category: 'Range', title: 'A long enough title here', condition: 'New', cost: 1 }).includes('above_retail'));
});

test('summarizeListings counts flagged units once however many problems they have', () => {
  const s = summarizeListings([{ sku: 'A', price: 0, model: '', category: '', title: '', condition: '', cost: 0 }, { sku: 'B', price: 500, model: 'M', category: 'Range', title: 'A proper long title', condition: 'New', cost: 300 }]);
  equal(s.checked, 2); equal(s.flagged, 1);
  assert(s.byProblem[0].count >= 1);
});

test('pricing flags: at or under cost + 10 percent, and above retail', () => {
  const f = pricingFlags([
    { sku: 'T', title: 'thin', price: 105, cost: 100, compare_at: 300 },
    { sku: 'R', title: 'over', price: 900, cost: 100, compare_at: 800 },
    { sku: 'OK', title: 'fine', price: 600, cost: 300, compare_at: 900 }
  ]);
  equal(f.thin.length, 1); equal(f.thin[0].sku, 'T');
  equal(f.aboveRetail.length, 1); equal(f.aboveRetail[0].sku, 'R');
});

test('against a real database: the queue, the lost demand, the listing check and the brief all read live rows', async () => {
  const { done } = await withTestDb();
  try {
    await query(`INSERT INTO products (sku, make, model, category, title, condition, price, compare_at, cost, active)
                 VALUES ('G1','LG','M1','Refrigerator','LG French Door Refrigerator','Refurbished',900,1500,500,true),
                        ('G2','GE','','Appliance','GE',NULL,0,NULL,NULL,true)`);
    await query(`INSERT INTO leads (side, company, source, stage, temperature, est_value, created_at)
                 VALUES ('bb','Hot Co','phone','new','hot',2500, now() - interval '30 hours')`);
    await query(`INSERT INTO leads (side, company, source, stage, lost_reason, wanted, wanted_category, created_at)
                 VALUES ('bb','Lost1','phone','lost','no_stock','Samsung range','range', now() - interval '3 days'),
                        ('bb','Lost2','social','lost','no_stock','GE range','range', now() - interval '2 days'),
                        ('bb','Lost3','phone','lost','no_stock','LG washer','washer', now() - interval '1 days'),
                        ('rs','RS lead','phone','lost','no_stock','a thing','other', now() - interval '1 days'),
                        ('bb','Imp','imported','new',NULL,NULL,NULL, now() - interval '1 days')`);
    const q = await salesQueue({ limit: 5 });
    equal(q.counts.leads, 1, 'only the open BB lead (not RS, not imported, not lost)');
    equal(q.waiting, 1);
    equal(q.items[0].who, 'Hot Co');
    const d = await lostDemand({ days: 30 });
    equal(d.total, 3, 'the RS Solutions lead is not counted');
    equal(d.byCategory[0].key, 'range');
    const l = await listingQuality();
    equal(l.checked, 2); equal(l.flagged, 1);
    const p = await pricingWatch();
    assert(Array.isArray(p.stale) && Array.isArray(p.thin));
    const brief = await buildGrowthBrief();
    assert(brief.sales && brief.demand && brief.listings && brief.pricing);
    for (const [label, fn] of GROWTH_CHECKS) {
      const issues = await fn();
      assert(Array.isArray(issues), label);
      for (const i of issues) for (const k of ['key', 'area', 'severity', 'title', 'speak', 'detail', 'count']) assert(i[k] != null, `${label}.${k}`);
    }
  } finally { done(); }
});

test('with no database every reader answers "nothing" instead of throwing', async () => {
  const q = await salesQueue();
  equal(q.items.length, 0);
  equal((await lostDemand()).total, 0);
  equal((await listingQuality()).checked, 0);
});

test('the growth module is read-only: no writes, no email, no text, no money', () => {
  const src = fs.readFileSync(new URL('../lib/manager-growth.js', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert(!/\b(INSERT|UPDATE|DELETE)\b\s/i.test(src.replace(/`[^`]*SELECT[^`]*`/gs, '')), 'no write statements');
  for (const banned of ['sendEmail', 'sendSms', 'recordInvoicePayment', 'markInvoicePaid', 'setModelPhoto', 'addTask', 'refundInvoice']) assert(!src.includes(banned), banned);
});
