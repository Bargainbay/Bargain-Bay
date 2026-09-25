// lib/environment.js — what a non-production deployment is allowed to touch.
//
// Until this existed, nothing distinguished staging from production. Point a
// second deployment at the existing environment variables — which is precisely
// what a staging environment IS — and it would email real customers about
// orders they did not place, text real drivers sign-in codes at three in the
// morning, and write "Sold" into the master tracker, which is the source of
// truth for the entire business and is not in this repo.
//
// THE FIRST TEST IS THE IMPORTANT ONE: production behaves exactly as it always
// has. Everything here is a no-op when VERCEL_ENV is "production".
import { suite, test, assert, equal } from './_harness.mjs';
import { deployEnv, isProduction, outbound, envBanner } from '../lib/environment.js';

const KEYS = ['VERCEL_ENV', 'NODE_ENV', 'ALLOW_REAL_OUTBOUND', 'STAGING_EMAIL_TO', 'STAGING_SMS_TO'];
function withEnv(vars, fn) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  try {
    for (const k of KEYS) delete process.env[k];
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
    return fn();
  } finally {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

suite('lib/environment — production is untouched');

test('in production EVERY outbound kind is allowed, with no redirect', () => {
  withEnv({ VERCEL_ENV: 'production' }, () => {
    assert(isProduction());
    for (const kind of ['email', 'sms', 'tracker', 'voice']) {
      const g = outbound(kind);
      assert(g.allowed, `${kind} must be allowed in production`);
      assert(!g.redirectTo, `${kind} must NOT be redirected in production`);
    }
    equal(envBanner(), null, 'no banner in production');
  });
});

test('production is decided by VERCEL_ENV, not NODE_ENV', () => {
  // NODE_ENV is 'production' for ANY `next build`, including a preview one, so
  // it cannot be used for this and never could. This is the whole reason the
  // module reads VERCEL_ENV first.
  withEnv({ VERCEL_ENV: 'preview', NODE_ENV: 'production' }, () => {
    equal(deployEnv(), 'preview', 'a preview build is not production');
    assert(!isProduction());
  });
});

suite('lib/environment — the master tracker');

test('a non-production deployment can NEVER write to the tracker', () => {
  // Not redirected, ever. There is no safe second spreadsheet, and a staging
  // deploy marking real units Sold with a real Date Sold is somebody's Saturday
  // reconstructing inventory from invoices.
  for (const env of ['preview', 'development']) {
    withEnv({ VERCEL_ENV: env, STAGING_EMAIL_TO: 'x@y.ca', STAGING_SMS_TO: '+1555' }, () => {
      const g = outbound('tracker');
      assert(!g.allowed, `tracker writable from ${env}`);
      assert(!g.redirectTo, 'and never redirected');
      assert(/tracker/i.test(g.reason), 'the reason names the tracker');
    });
  }
});

test('an outbound call is never placed from a non-production deployment', () => {
  withEnv({ VERCEL_ENV: 'preview' }, () => {
    const g = outbound('voice');
    assert(!g.allowed);
    assert(!g.redirectTo, 'there is no safe number to ring instead');
  });
});

suite('lib/environment — email and SMS are redirected, not lost');

test('with a staging address, mail is redirected there', () => {
  withEnv({ VERCEL_ENV: 'preview', STAGING_EMAIL_TO: 'staging@rssolutions.ca' }, () => {
    const g = outbound('email');
    assert(g.allowed, 'still sent, so you can see that mail works');
    equal(g.redirectTo, 'staging@rssolutions.ca');
  });
});

test('with NO staging address, nothing is sent at all', () => {
  // Fails closed. The alternative — falling through to the real recipient — is
  // the bug this module exists to prevent.
  withEnv({ VERCEL_ENV: 'preview' }, () => {
    const g = outbound('email');
    assert(!g.allowed, 'must not fall through to the real recipient');
    assert(/STAGING_EMAIL_TO/.test(g.reason), 'the reason says how to fix it');
  });
  withEnv({ VERCEL_ENV: 'preview' }, () => {
    const g = outbound('sms');
    assert(!g.allowed);
    assert(/STAGING_SMS_TO/.test(g.reason));
  });
});

test('SMS redirects independently of email', () => {
  withEnv({ VERCEL_ENV: 'preview', STAGING_SMS_TO: '+14374888549' }, () => {
    equal(outbound('sms').redirectTo, '+14374888549');
    assert(!outbound('email').allowed, 'email has its own address and its own answer');
  });
});

suite('lib/environment — the override');

test('ALLOW_REAL_OUTBOUND must be spelled exactly, and then allows everything', () => {
  withEnv({ VERCEL_ENV: 'preview', ALLOW_REAL_OUTBOUND: 'yes-i-mean-it' }, () => {
    for (const kind of ['email', 'sms', 'tracker', 'voice']) {
      assert(outbound(kind).allowed, `${kind} should be allowed under the override`);
    }
  });
});

test('a casual truthy value does NOT unlock it', () => {
  // Deliberately verbose to type. "true" or "1" would get set by somebody
  // copying an env var around without reading what it does.
  for (const v of ['true', '1', 'yes', 'YES-I-MEAN-IT']) {
    withEnv({ VERCEL_ENV: 'preview', ALLOW_REAL_OUTBOUND: v }, () => {
      assert(!outbound('tracker').allowed, `"${v}" must not unlock the tracker`);
    });
  }
});

suite('lib/environment — odds and ends');

test('an unknown outbound kind is refused, not waved through', () => {
  withEnv({ VERCEL_ENV: 'preview' }, () => {
    assert(!outbound('something-new').allowed, 'a kind nobody taught it about defaults to no');
  });
});

test('the banner names the environment for anything a human reads', () => {
  withEnv({ VERCEL_ENV: 'preview' }, () => equal(envBanner(), '[PREVIEW]'));
  withEnv({ VERCEL_ENV: 'development' }, () => equal(envBanner(), '[DEVELOPMENT]'));
  withEnv({ VERCEL_ENV: 'production' }, () => equal(envBanner(), null));
});

test('with nothing set at all it is development, and outbound is off', () => {
  // `npm run dev` — the common local case. Refusing is right: a developer
  // should not be able to text a driver by running the app.
  withEnv({}, () => {
    equal(deployEnv(), 'development');
    assert(!outbound('email').allowed);
    assert(!outbound('tracker').allowed);
  });
});

test('outside Vercel, NODE_ENV=production IS production', () => {
  // Documented fallback, for a self-hosted deployment where VERCEL_ENV does not
  // exist. It also means a local `next start` with production credentials
  // behaves as production — which is a deliberate act, unlike `npm run dev`.
  withEnv({ NODE_ENV: 'production' }, () => {
    equal(deployEnv(), 'production');
    assert(outbound('tracker').allowed);
  });
});
