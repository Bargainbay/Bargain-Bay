// Discover and run every test/*.test.mjs. `npm test`.
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runAll } from './_harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs')).sort();

if (!files.length) {
  console.error('No test files found.');
  process.exit(1);
}
for (const f of files) await import(pathToFileURL(join(here, f)).href);

process.exit((await runAll()) ? 1 : 0);
