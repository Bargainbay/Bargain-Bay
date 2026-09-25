// Next's own error hook. This is what makes lib/observe.js actually see things.
//
// `onRequestError` is called by the framework for every error thrown on the
// server — in a route handler, a server component, a server action — including
// the ones a `try/catch` turns into a 500 and the ones that escape entirely.
// That covers the whole app without a single call site being edited, and
// without monkey-patching console.error, which would report the many places
// that log an error and then deliberately carry on.
//
// Both exports are no-ops when SENTRY_DSN is unset (captureError returns early),
// so this file costs one module load and nothing else until it is configured.
import { captureError } from './lib/observe';

export async function onRequestError(error, request, context) {
  // AWAITED. A serverless instance is frozen the moment its response goes out,
  // so a floating promise here is a coin flip on whether the report ever
  // leaves — which is exactly the bug the dispatch completion emails had
  // (CLAUDE.md, "why the office stopped getting completion emails"). The send
  // is capped at 2s and cannot reject.
  await captureError(error, {
    tags: {
      where: context?.routePath || request?.path || 'request',
      routeType: context?.routeType,
      routerKind: context?.routerKind
    },
    extra: {
      renderSource: context?.renderSource,
      revalidateReason: context?.revalidateReason
    },
    request: {
      url: request?.path,
      method: request?.method,
      headers: request?.headers
    }
  });
}

export async function register() {
  // Edge has no `process`. The import is DYNAMIC as well as guarded: a static
  // one puts lib/observe-node in the Edge compilation graph, where Turbopack
  // sees `process.on` and warns on every build regardless of the check.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { installProcessHandlers } = await import('./lib/observe-node');
  installProcessHandlers();
}
