// Apply outstanding migrations, or report what is outstanding.
//
//   npm run migrate           apply everything not yet recorded
//   npm run migrate -- --dry  say what WOULD run, change nothing
//   npm run migrate -- --status   show the ledger
//
// Needs POSTGRES_URL. The same code runs behind /admin's button, so the
// terminal and the browser can never disagree about what has been applied.
import { migrate, migrationStatus, listMigrations } from '../lib/migrate.js';

const args = process.argv.slice(2);
const want = (f) => args.includes(`--${f}`);

if (!process.env.POSTGRES_URL) {
  console.error('POSTGRES_URL is not set.\n');
  console.error(`Found ${listMigrations().length} migration file(s) on disk:`);
  for (const m of listMigrations()) console.error('  ', m.id);
  process.exit(1);
}

if (want('status')) {
  const s = await migrationStatus();
  if (!s.ok) { console.error(s.error); process.exit(1); }
  for (const m of s.migrations) {
    const mark = m.changedSinceApplied ? 'CHANGED' : m.applied ? 'applied' : 'PENDING';
    console.log(`${mark.padEnd(8)} ${m.id}${m.appliedAt ? `  ${new Date(m.appliedAt).toISOString().slice(0, 19).replace('T', ' ')}` : ''}${m.ms != null ? `  ${m.ms}ms` : ''}`);
  }
  if (s.orphans.length) console.log(`\nRecorded in the database with no file here: ${s.orphans.join(', ')}`);
  console.log(`\n${s.pending.length} pending.`);
  process.exit(s.migrations.some((m) => m.changedSinceApplied) ? 1 : 0);
}

const res = await migrate({ dryRun: want('dry') });
if (!res.ok) {
  console.error(`\nFAILED: ${res.error}`);
  if (res.rolledBack) console.error('That migration was rolled back; nothing from it is in the database.');
  if (res.applied.length) console.error(`Applied before it stopped: ${res.applied.map((a) => a.id).join(', ')}`);
  process.exit(1);
}
if (want('dry')) {
  console.log(res.applied.length ? `Would apply:\n  ${res.applied.map((a) => a.id).join('\n  ')}` : 'Nothing to apply.');
} else {
  console.log(res.applied.length
    ? `Applied:\n  ${res.applied.map((a) => `${a.id}  ${a.ms}ms`).join('\n  ')}`
    : 'Nothing to apply — the database is up to date.');
}
if (res.skipped.length) console.log(`(${res.skipped.length} already applied)`);
