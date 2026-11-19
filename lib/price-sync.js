// A public price changed on the Pricing screen must land in the TRACKER as well as on the site.
//
// The site prices a unit from Retail x Condition % plus typed overrides (clearance / list-price
// overrides), so the override is what makes the site change. The sheet's Suggested Sale Price cell is
// what people READ off the tracker, so it gets the same number. Writing a number over that cell
// replaces its formula, so the original formula is kept (settings key tracker_price_originals) and put
// back by "Back to tracker price".
//
// Member prices have no column on the tracker, so they exist on the site only.
//
// Fails CLOSED in production: if the sheet cannot be written the caller makes NO change, so the
// tracker and the site never disagree about a price. Outside production (staging, local) there is no
// safe second sheet, so the tracker step is skipped and reported.
import { sheetsConfigured, writeTrackerPriceCell, writeTrackerPriceCells } from './sheets';
import { getSetting, setSetting } from './settings';
import { isProduction } from './environment';

const KEY = 'tracker_price_originals';

export async function pushPriceToTracker(sku, price) {
  if (!sheetsConfigured() || !isProduction()) return { skipped: true };
  const r = await writeTrackerPriceCell(sku, Math.round(Number(price) * 100) / 100);
  // Keep the original formula the first time only: a later change finds a typed number there.
  if (String(r.before).startsWith('=')) {
    const saved = (await getSetting(KEY, {})) || {};
    if (!saved[sku]) await setSetting(KEY, { ...saved, [sku]: r.before });
  }
  return { written: true, row: r.row };
}

export async function restoreTrackerPrice(sku) {
  if (!sheetsConfigured() || !isProduction()) return { skipped: true };
  const saved = (await getSetting(KEY, {})) || {};
  const original = saved[sku];
  if (!original) return { skipped: true, reason: 'no saved formula' };
  const r = await writeTrackerPriceCell(sku, original);
  const { [sku]: _gone, ...rest } = saved;
  await setSetting(KEY, rest);
  return { restored: true, row: r.row };
}

// Many units, ONE sheet read and ONE write: items = [{ sku, price }]. All or nothing (a SKU the sheet
// does not have stops everything), so a bulk change cannot half-reach the tracker.
export async function pushPricesToTracker(items) {
  if (!sheetsConfigured() || !isProduction()) return { skipped: true };
  const list = (items || []).filter((x) => x && x.sku && Number(x.price) > 0);
  if (!list.length) return { written: 0 };
  const res = await writeTrackerPriceCells(list.map((x) => ({ sku: x.sku, content: Math.round(Number(x.price) * 100) / 100 })));
  const saved = (await getSetting(KEY, {})) || {};
  const next = { ...saved };
  for (const r of res) if (String(r.before).startsWith('=') && !next[r.sku]) next[r.sku] = r.before;
  if (Object.keys(next).length !== Object.keys(saved).length) await setSetting(KEY, next);
  return { written: res.length };
}
