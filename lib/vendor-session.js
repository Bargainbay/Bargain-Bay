// THE vendor gate. Every vendor route and page goes through this file, and nothing else decides
// who a vendor user is, what their role may do, or whether they have passed the second factor.
//
//   const ctx = await requireVendor('orders.fulfil');        // null = refuse
//   const r   = await checkVendor('bank.edit', { stepUp: true });  // { ok, ctx } | { ok:false, reason, status }
//
// The vendor id comes from the session (lib/vendors.js `vendorAccess`) — never from a request.
//
// What it checks, in order, and every failure refuses:
//   1. a signed-in session, and an active grant for an approved/restricted/suspended vendor;
//   2. `can(role, action)` — lib/vendor-permissions.js, the only permission table;
//   3. the second factor (lib/vendor-mfa*.js):
//        - an ENROLLED user must carry a valid bb_vmfa marker, whatever their role;
//        - a role that needs MFA (owner) and is not enrolled is turned away once the grace
//          period after the grant has passed (when two-factor can be set up at all);
//   4. `stepUp: true` (changing the bank account, changing the team): enrolment is required
//      outright, and the last code must be no more than STEP_UP_MINUTES old.
//
// An action is REQUIRED. Calling requireVendor() with none refuses everything and logs, so a
// route that forgets to say what it is for cannot quietly become "any team member may".
// `requireVendorIdentity()` skips 2 and 3 — for the pages and routes where someone enrols or
// types their code, which they must reach BEFORE they have passed it. Nothing else may use it.
import { getSession } from './auth';
import { vendorAccess } from './vendors';
import { can, roleNeedsMfa, STEP_UP_MINUTES } from './vendor-permissions';
import { mfaState, mfaAvailable } from './vendor-mfa';
import { currentMarker } from './vendor-mfa-marker';

const refuse = (reason, status = 403) => ({ ok: false, reason, status });

/** Signed in and acting for a vendor — no role or second-factor check. Only the MFA routes and pages use this. */
export async function requireVendorIdentity() {
  const session = await getSession();
  if (!session?.email || !session.userId) return null;
  const vendor = await vendorAccess(session.email);
  return vendor ? { session, vendor } : null;
}

/** Where this user stands on the second factor. Throws on a database error: callers refuse. */
export async function mfaContext(session, vendor, { nowMs = Date.now() } = {}) {
  const st = await mfaState(session.userId);
  const marker = st.enrolled ? await currentMarker(session, { nowMs }) : null;
  const graceMs = vendor.mfa_grace_until ? new Date(vendor.mfa_grace_until).getTime() : NaN;
  const graceOver = !(graceMs > nowMs);          // missing or unreadable: over — fail closed
  const required = roleNeedsMfa(vendor.role);
  const available = mfaAvailable();
  return {
    enrolled: st.enrolled,
    pendingEnrolment: st.pending,
    recoveryLeft: st.recoveryLeft,
    required,
    available,
    verified: !!marker,
    verifiedAtMs: marker?.atMs ?? null,
    graceUntil: Number.isFinite(graceMs) ? new Date(graceMs).toISOString() : null,
    daysLeft: Number.isFinite(graceMs) ? Math.max(0, Math.ceil((graceMs - nowMs) / 86400000)) : 0,
    mustEnrol: required && !st.enrolled && available && graceOver
  };
}

export async function checkVendor(action, { stepUp = false, nowMs = Date.now() } = {}) {
  if (typeof action !== 'string' || !action) {
    console.error('requireVendor/checkVendor called without an action — refusing. Name what this route is for.');
    return refuse('no_action');
  }
  const id = await requireVendorIdentity();
  if (!id) return refuse('no_access');
  const { session, vendor } = id;
  if (!can(vendor.role, action)) return refuse('forbidden');
  let mfa;
  try { mfa = await mfaContext(session, vendor, { nowMs }); } catch (e) {
    console.error('vendor MFA state unreadable — refusing', e?.message);
    return refuse('mfa_error', 503);
  }
  if (mfa.enrolled && !mfa.verified) return refuse('mfa_verify');
  if (mfa.mustEnrol) return refuse('mfa_enrol');
  if (stepUp) {
    if (!mfa.enrolled) return refuse('mfa_enrol');           // bank / team changes need it outright
    if (!(nowMs - mfa.verifiedAtMs <= STEP_UP_MINUTES * 60000)) return refuse('stepup');
  }
  return { ok: true, ctx: { session, vendor, mfa } };
}

/** The ctx for a permitted, second-factor-verified vendor user, or null. */
export async function requireVendor(action, opts) {
  const r = await checkVendor(action, opts);
  return r.ok ? r.ctx : null;
}

// What an API route says when it refuses. The `mfa` field tells the portal what to do next.
export function denial(r) {
  const body = { error: 'Not authorized' };
  if (r.reason === 'mfa_verify') { body.mfa = 'verify'; body.error = 'Enter your two-factor code to continue.'; }
  if (r.reason === 'mfa_enrol') { body.mfa = 'enrol'; body.error = 'Set up two-factor sign-in to continue.'; }
  if (r.reason === 'stepup') { body.mfa = 'stepup'; body.error = 'Enter a fresh two-factor code to do this.'; }
  return { body, status: r.status || 403 };
}
