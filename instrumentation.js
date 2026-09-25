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
  // Edge has no `process`; only the Node runtime gets the process-level nets.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // A rejected promise nobody awaited is the shape most of this codebase's
  // background work takes — a best-effort email, a photo upload, a tracker
  // poll. `onRequestError` never sees those: they are not attached to a
  // request, and Node's default is to print a warning and move on.
  process.on('unhandledRejection', (reason) => {
    captureError(reason instanceof Error ? reason : new Error(String(reason)), {
      tags: { where: 'unhandledRejection' }
    }).catch(() => {});
  });

  process.on('uncaughtException', (err) => {
    // Report and RE-THROW by doing nothing else: this handler deliberately does
    // not swallow. A process that keeps running after an uncaught exception is
    // a process in an unknown state, and Next/Node will tear it down. The
    // report is fire-and-forget because there may be no tick left to await in.
    captureError(err, { tags: { where: 'uncaughtException' }, level: 'fatal' }).catch(() => {});
  });
}
