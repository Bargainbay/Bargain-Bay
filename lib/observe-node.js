// Node-runtime-only process handlers, kept OUT of instrumentation.js so the
// Edge bundle never sees them.
//
// instrumentation.js runs in both runtimes. A runtime check (`if
// NEXT_RUNTIME !== 'nodejs' return`) is correct at runtime and invisible to the
// bundler: Turbopack analyses the module statically, finds `process.on` in
// something it is compiling for Edge, and warns on every build. Two noisy
// warnings on every build is how a real one gets scrolled past. A dynamic
// import behind the same check keeps the module out of that graph entirely.
import { captureError } from './observe';

let installed = false;

export function installProcessHandlers() {
  if (installed) return;
  installed = true;

  // Warm the staff-roles cache before this instance serves anything. Without
  // it, the first request on a cold instance sees an empty cache and a
  // table-granted user is refused until the background refresh lands — which
  // fails closed (safe) but reads like a broken login. Environment-list admins
  // are unaffected either way; they never consult the cache.
  import('./staff')
    .then((m) => m.refreshStaff({ force: true }))
    .catch(() => {});

  // A rejected promise nobody awaited is the shape most background work here
  // takes — a best-effort email, a photo upload, a tracker poll.
  // `onRequestError` never sees those: they are not attached to a request, and
  // Node's default is to print a warning and carry on.
  process.on('unhandledRejection', (reason) => {
    captureError(reason instanceof Error ? reason : new Error(String(reason)), {
      tags: { where: 'unhandledRejection' }
    }).catch(() => {});
  });

  // This handler deliberately does not swallow. A process still running after
  // an uncaught exception is a process in an unknown state; Node tears it down
  // and that is correct. Fire-and-forget because there may be no tick left.
  process.on('uncaughtException', (err) => {
    captureError(err, { tags: { where: 'uncaughtException' }, level: 'fatal' }).catch(() => {});
  });
}
