// Error reporting — the smoke alarm this codebase did not have.
//
// The house style here is to DEGRADE OPEN: a failed lookup returns "nothing"
// rather than an error, because losing a real sale is worse than admitting a
// junk one. That is the right call and it is not what changes here. The problem
// is the other half of it — 263 `console.error` calls whose entire audience is
// Vercel's log tail, which nobody is reading at 2am. Failures were invisible by
// construction, and CLAUDE.md records what that costs: the CDA watcher never
// once read the workbook and nobody knew for months; QuickBooks imported a demo
// company's spending for 48 days behind a green CONNECTED badge. Each was fixed
// by bolting a throttled email onto that one feature. This is the general case.
//
// NO SDK, DELIBERATELY. @sentry/nextjs pulls in OpenTelemetry and a build-time
// webpack plugin, and pays a cold-start cost on every function — which matters
// because the driver's close-out runs inside the driver's own request, on one
// bar of signal, with a signature that exists nowhere else until it lands.
// Sentry's ingest endpoint is a plain HTTPS POST, so this talks to it the same
// way lib/sms.js talks to Twilio and lib/email.js talks to Resend.
//
// What you give up versus the SDK: no automatic instrumentation, no
// source-mapped frames (minified names in the stack), no tracing, no replay.
// What you keep: the exception, its stack, who it happened to, which request,
// which release — and an alert. That is the gap between blind and not blind.
//
// DORMANT WITHOUT `SENTRY_DSN`, exactly like every other integration here.
// Nothing in this file can throw, and nothing in it can block a response for
// longer than REPORT_TIMEOUT_MS.

const TIMEOUT_MS = 2000;

// Per-instance dedupe. Serverless gives each instance its own memory, so this
// throttles a LOOP (the same error a thousand times in one request) rather than
// a fleet-wide count — same caveat the /api/chat rate limiter carries. That is
// the case worth stopping: the fleet-wide duplicate is Sentry's job.
const DEDUPE_MS = 60_000;
const DEDUPE_MAX = 200;
const recent = new Map();

function throttled(key) {
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < DEDUPE_MS) return true;
  // Bounded: a long-lived instance seeing many distinct errors must not grow a
  // map forever. Oldest insertion goes first — Map keeps insertion order.
  if (recent.size >= DEDUPE_MAX) recent.delete(recent.keys().next().value);
  recent.set(key, now);
  return false;
}

export function observeConfigured() {
  return !!process.env.SENTRY_DSN;
}

// https://<publicKey>@<host>/<projectId>
function parseDsn(dsn) {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, '');
    if (!u.username || !projectId) return null;
    return {
      key: u.username,
      url: `${u.protocol}//${u.host}/api/${projectId}/envelope/`
    };
  } catch {
    return null;
  }
}

const release = () =>
  process.env.SENTRY_RELEASE ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  'dev';

const environment = () =>
  process.env.SENTRY_ENVIRONMENT ||
  process.env.VERCEL_ENV ||
  process.env.NODE_ENV ||
  'development';

// `at fn (/var/task/lib/jobs.js:412:19)` -> a Sentry frame. Sentry renders
// frames oldest-first, and Error.stack is newest-first, so the list is
// reversed. Best-effort: an unparseable line is dropped, never thrown on.
function framesFrom(stack) {
  const lines = String(stack || '').split('\n').slice(1);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/);
    if (!m) continue;
    const [, fn, file, lineno, colno] = m;
    out.push({
      function: fn || '?',
      filename: file,
      lineno: Number(lineno),
      colno: Number(colno),
      // Anything not under node_modules is ours — this is what makes Sentry
      // group on OUR frame rather than on a driver deep inside pg.
      in_app: !file.includes('node_modules')
    });
  }
  return out.reverse();
}

const hex = (n) => {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
};

// Header values, query strings and bodies carry session cookies, Twilio
// signatures, and the CRON_SECRET. None of that is worth having in an error
// report, and all of it is worth NOT having in a third party's database.
const DROP_HEADERS = /^(cookie|authorization|x-sentry-auth|x-twilio-signature|x-rsops-key|x-vercel-|proxy-)/i;
const SECRET_KEY = /(token|secret|password|passwd|auth|key|signature|cookie|ssn|card|cvv)/i;

function safeHeaders(headers) {
  const out = {};
  try {
    for (const [k, v] of headers.entries()) {
      if (DROP_HEADERS.test(k)) continue;
      out[k] = String(v).slice(0, 200);
    }
  } catch { /* not a Headers */ }
  return out;
}

// Strip a query string wholesale: it is where the old `?key=<CRON_SECRET>`
// lived, and where the hosted-record `?t=` tokens live now.
function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname + (u.search ? '?[stripped]' : '');
  } catch {
    return String(url || '').split('?')[0];
  }
}

function safeExtra(extra) {
  const out = {};
  for (const [k, v] of Object.entries(extra || {})) {
    if (SECRET_KEY.test(k)) { out[k] = '[redacted]'; continue; }
    if (v == null || typeof v === 'boolean' || typeof v === 'number') { out[k] = v; continue; }
    out[k] = String(v).slice(0, 1000);
  }
  return out;
}

/**
 * Report an error. Never throws, never rejects, never blocks past TIMEOUT_MS.
 *
 * Await it on a path that is about to return a response (a serverless instance
 * is frozen the moment the response goes out, so a floating promise is a coin
 * flip — the same bug the dispatch completion emails had). Elsewhere, calling
 * it without awaiting is fine.
 */
export async function captureError(error, {
  tags = {}, extra = {}, user = null, request = null, level = 'error', fingerprint = null
} = {}) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return { ok: false, skipped: true };

  const err = error instanceof Error ? error : new Error(String(error && error.message || error));

  // Dedupe on what the error IS, not on when it happened.
  const key = fingerprint || `${err.name}:${err.message}:${tags.where || ''}`;
  if (throttled(key)) return { ok: false, throttled: true };

  const target = parseDsn(dsn);
  if (!target) {
    console.error('SENTRY_DSN is set but could not be parsed — error reporting is OFF');
    return { ok: false, error: 'bad dsn' };
  }

  const event = {
    event_id: hex(32),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level,
    logger: tags.where || 'app',
    release: release(),
    environment: environment(),
    server_name: process.env.VERCEL_REGION || undefined,
    tags: { ...tags, runtime: process.env.NEXT_RUNTIME || 'nodejs' },
    extra: safeExtra(extra),
    exception: {
      values: [{
        type: err.name || 'Error',
        value: String(err.message || '').slice(0, 2000),
        stacktrace: { frames: framesFrom(err.stack) }
      }]
    },
    ...(fingerprint ? { fingerprint: [fingerprint] } : {}),
    ...(user ? { user: { id: user.id ?? undefined, email: user.email ?? undefined } } : {}),
    ...(request ? {
      request: {
        url: safeUrl(request.url),
        method: request.method,
        headers: request.headers ? safeHeaders(request.headers) : undefined
      }
    } : {})
  };

  // Envelope format: three newline-delimited JSON lines.
  const body =
    JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() }) + '\n' +
    JSON.stringify({ type: 'event' }) + '\n' +
    JSON.stringify(event) + '\n';

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target.url, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=bargainbay/1.0, sentry_key=${target.key}`
      },
      body
    });
    // A failure here goes to the console and no further. Reporting an error
    // about the error reporter is how you build a loop.
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, eventId: event.event_id };
  } catch {
    return { ok: false, error: 'send failed' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Report a CONDITION rather than a thrown error — the scheduled job that read
 * nothing, the report section that came back empty because its query timed out.
 * This is the half that was missing: the incidents in CLAUDE.md were not
 * crashes, they were silence, and silence never reaches an exception handler.
 */
export async function captureMessage(message, opts = {}) {
  const err = new Error(String(message));
  err.name = opts.name || 'Reported';
  return captureError(err, { level: 'warning', ...opts });
}
