// Let plain Node import the app's modules.
//
// Every internal import in this codebase is extensionless — `from './db'`,
// `from '../lib/observe'` — which is what Next's bundler resolves and what
// plain Node ESM does not. The options were to put `.js` on several hundred
// import statements across the app, or to teach the test runner the same
// resolution the bundler already does. This is the second one: the app is not
// reshaped to suit its tests.
//
// It only ever adds an extension to a RELATIVE specifier that has none, and
// only when that file actually exists, so it cannot mask a genuine typo.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    for (const ext of ['.js', '.jsx', '.mjs', '/index.js']) {
      try {
        const url = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(url))) return next(specifier + ext, context);
      } catch { /* not a resolvable URL — fall through to Node */ }
    }
  }
  return next(specifier, context);
}
