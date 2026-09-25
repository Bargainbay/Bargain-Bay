// Which deployment this is, and what it is allowed to touch in the real world.
//
// WHY THIS EXISTS. Until now nothing in the app distinguished staging from
// production. Point a second deployment at the existing environment variables —
// which is exactly what a staging environment is — and it would:
//
//   · email real customers order confirmations for orders they did not place,
//   · text real drivers sign-in codes at three in the morning,
//   · place outbound phone calls to the owner,
//   · and write "Sold" into the MASTER TRACKER, which is the source of truth
//     for the entire business and is not in this repo.
//
// That last one is the reason this module is not optional. A staging deploy
// that marks units sold in the production tracker is not an inconvenience; it
// is somebody's Saturday, reconstructing inventory from invoices.
//
// THE RULE: production behaves exactly as it always has. Everything here is a
// no-op when VERCEL_ENV is "production", and there is a test that says so.
// Outside production, outbound effects are either REDIRECTED to one address the
// team controls, or REFUSED — never quietly delivered.

/** 'production' | 'preview' | 'development' */
export function deployEnv() {
  // Vercel sets VERCEL_ENV on every deployment; it is the only thing that
  // actually knows. NODE_ENV is 'production' for ANY `next build`, including a
  // preview one, so it cannot be used for this and never could.
  const v = process.env.VERCEL_ENV;
  if (v === 'production' || v === 'preview' || v === 'development') return v;
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

export const isProduction = () => deployEnv() === 'production';

// An explicit override, for the one case the rule above gets wrong: running a
// local copy against production data on purpose (a data fix, a migration
// rehearsal). Deliberately verbose to type and logged when used.
function overridden() {
  if (process.env.ALLOW_REAL_OUTBOUND === 'yes-i-mean-it') {
    console.warn('ALLOW_REAL_OUTBOUND is set — outbound effects will reach the real world from a non-production deployment.');
    return true;
  }
  return false;
}

/**
 * May this kind of outbound effect reach the real world?
 *
 * Returns { allowed, redirectTo?, reason }.
 *
 *   'email' / 'sms' — REDIRECTED outside production when an address is
 *      configured, because you still want to see that mail and texts work.
 *   'tracker' / 'voice' — REFUSED outright. There is nowhere safe to redirect
 *      a write to somebody's master spreadsheet, and a phone rings a person.
 */
export function outbound(kind) {
  if (isProduction() || overridden()) return { allowed: true };

  const env = deployEnv();
  switch (kind) {
    case 'email': {
      const to = process.env.STAGING_EMAIL_TO;
      return to
        ? { allowed: true, redirectTo: to, reason: `${env}: redirected` }
        : { allowed: false, reason: `${env}: no STAGING_EMAIL_TO set, so nothing is sent` };
    }
    case 'sms': {
      const to = process.env.STAGING_SMS_TO;
      return to
        ? { allowed: true, redirectTo: to, reason: `${env}: redirected` }
        : { allowed: false, reason: `${env}: no STAGING_SMS_TO set, so nothing is sent` };
    }
    case 'tracker':
      // NEVER redirected. The master tracker is the business's source of truth
      // and is not in this repo; there is no safe second copy to write to.
      return { allowed: false, reason: `${env}: the master tracker is never written from a non-production deployment` };
    case 'voice':
      return { allowed: false, reason: `${env}: outbound calls ring a real person` };
    default:
      return { allowed: false, reason: `${env}: unknown outbound kind "${kind}"` };
  }
}

/** A one-line banner for anything a human reads, so staging is never mistaken for production. */
export function envBanner() {
  if (isProduction()) return null;
  return `[${deployEnv().toUpperCase()}]`;
}
