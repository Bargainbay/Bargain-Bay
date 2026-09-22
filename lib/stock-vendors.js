// Our stock, grouped by who it came from.
//
// The tracker has had a Vendor column all along and nothing ever read it, so
// "what have we still got of Abi's?" was a question you answered by scrolling a
// spreadsheet. It matters most for the vendors who DROP OFF — their appliances
// are in our building, we owe them nothing until each one sells, and the only
// record that we hold something of theirs is that column.
//
// Read from the tracker, never from `products`: the website only knows about
// units it can sell, and the ones sitting untested or waiting for parts are
// exactly the ones a vendor rings up about.
import { readTrackerRows, sheetsConfigured } from './sheets';
import { isSoldStatus } from './stock-match';
import { currentLocations } from './locations';

const NOT_RECORDED = 'Not recorded';
const num = (v) => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const isSalvage = (status) => /salvage/i.test(String(status || ''));
const isConsigned = (invoice) => /^consignment/i.test(String(invoice || '').trim());

// The four buckets a unit in the building can be in, in the order a person
// thinks about them: sellable now, being worked on, not sellable, salvage.
function bucketOf(row) {
  const s = String(row.status || '').trim().toLowerCase();
  if (isSalvage(s)) return 'salvage';
  if (s === 'tested working') return num(row.price) > 0 ? 'live' : 'unpriced';
  if (s.startsWith('tested working')) return 'working';   // needs cleaning / needs QA
  return 'notReady';                                      // untested, not working, parts
}

// Vendor names are typed by hand on every path, so "SecondShop", "secondshop "
// and "Second Shop" are one vendor. The FIRST spelling seen is the one shown —
// renaming a vendor is a decision for the tracker, not something to do on a
// report.
const keyOf = (name) => String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');

export async function stockByVendor({ withLocations = true } = {}) {
  if (!sheetsConfigured()) throw new Error('The tracker is not connected (GOOGLE_CREDENTIALS / SHEET_ID).');
  const { vendors: list, totals } = groupRows(await readTrackerRows());

  // Where each unit is standing. Soft-fails to "no spot" — the vendor answer is
  // useful without it, and this report must not depend on the warehouse tables
  // existing.
  if (withLocations) {
    try {
      const where = await currentLocations(list.flatMap((v) => v.units.map((u) => u.sku)));
      // currentLocations keys on the SKU as the site spells it (trimmed).
      for (const v of list) for (const u of v.units) u.location = where.get(String(u.sku || '').trim())?.code || null;
    } catch (e) {
      console.error('stock by vendor: locations unavailable', e?.message || e);
    }
  }
  return { vendors: list, totals, generatedAt: new Date().toISOString() };
}

// The grouping itself, pure and exported so it can be tested without a tracker.
export function groupRows(rows = []) {
  const vendors = new Map();
  for (const r of rows) {
    const name = String(r.vendor || '').trim() || NOT_RECORDED;
    const key = keyOf(name) || 'not-recorded';
    const v = vendors.get(key) || {
      key, name, units: [], sold: 0, soldValue: 0,
      counts: { live: 0, working: 0, unpriced: 0, notReady: 0, salvage: 0 },
      retail: 0, cost: 0, consigned: 0, costMissing: 0, oldest: ''
    };
    if (isSoldStatus(r.status)) {
      v.sold += 1;
      v.soldValue += num(r.price);
      vendors.set(key, v);
      continue;
    }
    const bucket = bucketOf(r);
    v.counts[bucket] += 1;
    v.retail += num(r.retail);
    v.cost += num(r.cost);
    if (!num(r.cost)) v.costMissing += 1;
    if (isConsigned(r.invoice)) v.consigned += 1;
    if (r.dateReceived && (!v.oldest || r.dateReceived < v.oldest)) v.oldest = r.dateReceived;
    v.units.push({
      sku: r.sku, make: r.make, model: r.model, description: r.description,
      status: r.status || 'Untested', bucket, dateReceived: r.dateReceived,
      retail: num(r.retail), cost: num(r.cost), price: num(r.price),
      lot: r.lot, consigned: isConsigned(r.invoice), invoice: r.invoice
    });
    vendors.set(key, v);
  }

  const vendorList = [...vendors.values()]
    .map((v) => ({ ...v, onHand: v.units.length }))
    .filter((v) => v.onHand || v.sold)
    .sort((a, b) => b.onHand - a.onHand || a.name.localeCompare(b.name));

  return {
    vendors: vendorList,
    totals: {
      vendors: vendorList.length,
      onHand: vendorList.reduce((a, v) => a + v.onHand, 0),
      retail: vendorList.reduce((a, v) => a + v.retail, 0),
      cost: vendorList.reduce((a, v) => a + v.cost, 0),
      consigned: vendorList.reduce((a, v) => a + v.consigned, 0)
    }
  };
}

// Cost is the owner's to see, not the sales floor's (same rule as the invoice
// form's cost box and the dashboard's Profit column). Stripped on the SERVER, so
// a non-admin is never sent the figures at all.
export function withoutCost(report) {
  return {
    ...report,
    vendors: report.vendors.map(({ cost, costMissing, ...v }) => ({
      ...v, units: v.units.map(({ cost: _c, ...u }) => u)
    })),
    totals: { ...report.totals, cost: undefined }
  };
}

// Vendor names already in use, for the "who dropped this off?" box — so one
// vendor doesn't become three spellings. Drop-off vendors first: they are the
// ones a rep books a unit in against.
export async function knownVendors() {
  if (!sheetsConfigured()) return [];
  const rows = await readTrackerRows().catch(() => []);
  const seen = new Map();
  for (const r of rows) {
    const name = String(r.vendor || '').trim();
    if (!name) continue;
    const key = keyOf(name);
    const e = seen.get(key) || { name, units: 0, consigned: 0 };
    e.units += 1;
    if (isConsigned(r.invoice)) e.consigned += 1;
    seen.set(key, e);
  }
  return [...seen.values()]
    .sort((a, b) => (b.consigned > 0) - (a.consigned > 0) || b.units - a.units)
    .map((v) => v.name);
}
