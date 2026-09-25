// Take a backup, or restore one.
//
//   POSTGRES_URL=... npm run backup                    -> backups/bb-<date>.json
//   POSTGRES_URL=... npm run backup -- --out path.json
//   POSTGRES_URL=... npm run backup -- --restore f.json [--truncate]
//   POSTGRES_URL=... npm run backup -- --verify f.json
//
// --verify is the one worth running: it checks a file is a readable dump and
// reports what is in it, without touching any database. A backup nobody has
// opened is a claim, not a backup.
import fs from 'node:fs';
import path from 'node:path';
import { dump, restore } from '../lib/backup.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

function summarise(d) {
  const withRows = Object.entries(d.tables).filter(([, r]) => r.length);
  console.log(`taken   ${d.takenAt}`);
  console.log(`format  ${d.format}`);
  console.log(`tables  ${Object.keys(d.tables).length} (${withRows.length} with rows)`);
  console.log(`rows    ${d.rowCount}`);
  if (withRows.length) {
    console.log('\nlargest:');
    for (const [name, rows] of withRows.sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
      console.log(`  ${String(rows.length).padStart(7)}  ${name}`);
    }
  }
}

// ---- verify: no database needed ----
if (flag('verify')) {
  const file = value('verify');
  if (!file) { console.error('--verify needs a file'); process.exit(1); }
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { console.error(`Could not read ${file}: ${e.message}`); process.exit(1); }
  if (!d || !d.tables) { console.error(`${file} is not a dump (no \`tables\`).`); process.exit(1); }
  summarise(d);
  const empty = d.rowCount === 0;
  console.log(empty ? '\nWARNING: this dump contains NO ROWS.' : '\nLooks like a dump.');
  process.exit(empty ? 1 : 0);
}

if (!process.env.POSTGRES_URL) {
  console.error('POSTGRES_URL is not set.');
  process.exit(1);
}

// ---- restore ----
if (flag('restore')) {
  const file = value('restore');
  if (!file) { console.error('--restore needs a file'); process.exit(1); }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'));

  // Restoring over a live database is the single most destructive thing here.
  const target = process.env.POSTGRES_URL.replace(/:[^:@/]+@/, ':***@');
  console.error(`Restoring ${d.rowCount} rows from ${file}`);
  console.error(`into ${target}`);
  if (flag('truncate')) console.error('--truncate: EVERY TABLE IN THE TARGET WILL BE EMPTIED FIRST.');
  if (!flag('yes')) {
    console.error('\nRefusing without --yes. Read the two lines above first.');
    process.exit(1);
  }
  const res = await restore(d, { truncate: flag('truncate') });
  console.log(`Restored ${res.rowCount} rows.`);
  process.exit(0);
}

// ---- backup ----
const out = value('out') || path.join('backups', `bb-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
const d = await dump();
fs.writeFileSync(out, JSON.stringify(d));
summarise(d);
console.log(`\nWrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
if (!d.rowCount) {
  console.error('\nWARNING: that backup is EMPTY. Check POSTGRES_URL points where you think.');
  process.exit(1);
}
