// REGENERATE data/catalog.json FROM THE MASTER TRACKER — DISABLED BY DEFAULT.
//
// Read this before re-enabling it.
//
// data/catalog.json was deliberately EMPTIED in #124 ("decommission the stale
// catalog.json fallback — Sarah's phantom inventory"). It is an offline
// snapshot that lib/inventory.js falls back to when the products table can't be
// read, and it went months out of date; twice, a transient database hiccup made
// Sarah report that months-old stock list as current fact to a customer.
//
// The file being empty is the SAFETY PROPERTY, not an accident: `fileUnits` is
// then `[]`, so the fallback degrades to "no stock right now" instead of to
// "here is what we had in June". Filling it back in re-arms the exact bug.
//
// Postgres `products` (synced from the tracker by /api/admin/sync-inventory and
// the sync-inventory cron) is the sole source of truth. That path is live, it
// is what the storefront reads, and it needs nothing from this script.
//
// The nightly GitHub Action that used to run this was removed in the same
// change that added this guard. It had never once succeeded in the three months
// it was scheduled — and had it succeeded, it would have committed a
// repopulated catalog.json to main and auto-deployed the regression.
//
// If you genuinely need the snapshot (an offline demo, say), you have to ask:
//     npm run sync -- --force
// and you should expect to revert data/catalog.json afterwards.
import fs from 'fs';

const force = process.argv.includes('--force');
if (!force) {
  console.error(
    'sync-sheet: refusing to write data/catalog.json.\n' +
    '  That file is intentionally empty (see #124 — the stale-fallback bug).\n' +
    '  Live inventory is the Postgres products table; use /api/admin/sync-inventory.\n' +
    '  If you really mean it: npm run sync -- --force'
  );
  process.exit(1);
}

const { readAvailable } = await import('../lib/sheets.js');
const units = await readAvailable();
const payload = { generatedAt: new Date().toISOString().slice(0, 10), units };
fs.writeFileSync('data/catalog.json', JSON.stringify(payload, null, 1));
console.error(
  `\n!!  Wrote ${units.length} units into data/catalog.json.\n` +
  '!!  This file is meant to stay EMPTY. Revert it before committing, or you\n' +
  '!!  are re-arming the stale-inventory fallback that #124 removed.\n'
);
