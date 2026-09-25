// A test harness in fifty lines, with no dependencies.
//
// Phase 1 picks a real runner (Vitest + PGlite, to get a live Postgres under
// the money code). This is not that. It exists because Phase 0 shipped changes
// to the database TLS config, the cron gate and a brand-new error reporter, and
// "I ran a script once on my laptop" is not a guarantee anybody else inherits.
//
// Zero dependencies for the same reason eslint.config.mjs has none: a
// devDependency means a package-lock.json change, and a lockfile out of step
// with package.json makes `npm ci` fail — which is what Vercel builds with. A
// test must never be able to break a deploy.
const files = [];
let current = null;

export function suite(name) {
  current = { name, tests: [] };
  files.push(current);
}

export function test(name, fn) {
  if (!current) suite('(unnamed)');
  current.tests.push({ name, fn });
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

export function equal(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || 'not equal'}\n     expected: ${b}\n     actual:   ${a}`);
}

export async function runAll() {
  let pass = 0, fail = 0;
  for (const f of files) {
    console.log(`\n${f.name}`);
    for (const t of f.tests) {
      try {
        await t.fn();
        console.log(`  \x1b[32m✓\x1b[0m ${t.name}`);
        pass++;
      } catch (e) {
        console.log(`  \x1b[31m✗\x1b[0m ${t.name}`);
        console.log(`    ${String(e.message).split('\n').join('\n    ')}`);
        fail++;
      }
    }
  }
  console.log(`\n${pass} passed, ${fail} failed\n`);
  return fail;
}
