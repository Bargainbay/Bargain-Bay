// Refresh data/catalog.json from the master tracker's available units.
// Run on a schedule (e.g. Vercel Cron / scheduled task) or manually: npm run sync
// Needs GOOGLE_CREDENTIALS + SHEET_ID. Writes { generatedAt, units: [...] }.
// (The same file can also be regenerated from the master xlsx — any script
// that emits the same shape works.)
import { readAvailable } from '../lib/sheets.js';
import fs from 'fs';

const units = await readAvailable();
const payload = {
  generatedAt: new Date().toISOString().slice(0, 10),
  units
};
fs.writeFileSync('data/catalog.json', JSON.stringify(payload, null, 1));
console.log(`Synced ${units.length} available units into data/catalog.json`);
