// Let plain Node import the app's modules — used by `npm test` and `npm run migrate`.
//
// Every internal import in this codebase is extensionless — `from './db'`,
// `from '../lib/observe'` — which is what Next's bundler resolves and what
// plain Node ESM does not. The options were to put `.js` on several hundred
// import statements across the app, or to teach plain Node the same
// resolution the bundler already does. This is the second one: the app is not
// reshaped to suit the tools that read it.
//
// It only ever adds an extension to a RELATIVE specifier that has none, and
// only when that file actually exists, so it cannot mask a genuine typo.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  // `import x from './db'` -> './db.js'
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    for (const ext of ['.js', '.jsx', '.mjs', '/index.js']) {
      try {
        const url = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(specifier + ext, context);
      } catch { /* not a resolvable URL — fall through to Node */ }
    }
  }

  // `import data from '../data/x.json'` — plain Node ESM requires an explicit
  // `with { type: 'json' }` attribute and Next's bundler does not, so the app
  // is written without one (lib/pricing.js, lib/images.js, lib/inventory.js).
  // Supplying it here keeps the attribute out of app code that does not need it.
  if (/\.json$/i.test(specifier)) {
    // The attribute has to come back on the RESULT — passing it down via
    // `context` is not what Node validates against.
    const resolved = await next(specifier, context);
    return { ...resolved, importAttributes: { type: 'json' } };
  }

  return next(specifier, context);
}
