// A seller accepting the marketplace's policies. See lib/marketplace-policies.js and docs/marketplace/PLAN.md §14.
//
// What must be accepted is every PUBLISHED document marked acceptRequired, at its CURRENT version. Publishing a
// draft, or bumping a version, therefore asks every seller again — nothing else is needed.
//
//   * Only the account OWNER can accept: it binds the business.
//   * The seller says which versions they are accepting, and the server refuses if those are not the current
//     ones — so a policy cannot change between the seller reading it and pressing the button.
//   * Not accepting stops NEW listings (createDraft / submitListing check `mustAccept`). It never blocks an
//     order already paid for: stranding a customer's unit over a click would be the worse outcome.
import { query, withTransaction } from './db';
import { requiredPolicies } from './marketplace-policies';
import { logVendorEvent } from './vendors';

/** Required policies this seller has not accepted at their current version. */
export async function pendingPolicies(vendorId, q = query) {
  const need = requiredPolicies();
  if (!need.length) return [];
  const { rows } = await q('SELECT policy, version FROM policy_acceptances WHERE vendor_id = $1', [vendorId]);
  const have = new Set(rows.map((r) => `${r.policy}@${r.version}`));
  return need.filter((p) => !have.has(`${p.slug}@${p.version}`));
}

/** Throws a plain message when the seller still has to accept something. */
export async function mustAccept(vendorId, q = query) {
  const pending = await pendingPolicies(vendorId, q);
  if (pending.length) {
    throw new Error(`Please read and accept our marketplace policies first (${pending.map((p) => p.title).join(', ')}). You will find them under Policies in your dashboard.`);
  }
}

/** { accepted:[{policy,version,by,at}], pending:[policy objects] } for the dashboard. */
export async function acceptanceStatus(vendorId) {
  const { rows } = await query(
    'SELECT policy, version, accepted_by, accepted_at FROM policy_acceptances WHERE vendor_id = $1 ORDER BY accepted_at DESC', [vendorId]);
  return {
    accepted: rows.map((r) => ({ policy: r.policy, version: r.version, by: r.accepted_by, at: r.accepted_at })),
    pending: await pendingPolicies(vendorId)
  };
}

/**
 * Accept the given policies at the given versions. `accepting` = [{ policy, version }] exactly as shown to the
 * seller. Accepts nothing unless every one of them is still current and required.
 */
export async function acceptPolicies(vendorId, { role, by, ip, accepting }) {
  if (role !== 'owner') throw new Error('Only the account owner can accept the policies for the business.');
  if (!by) throw new Error('Who is accepting?');
  const need = requiredPolicies();
  const wanted = Array.isArray(accepting) ? accepting : [];
  for (const a of wanted) {
    const p = need.find((x) => x.slug === a.policy);
    if (!p) throw new Error('That policy is not one you need to accept.');
    if (Number(a.version) !== p.version) throw new Error(`${p.title} has changed since you opened it — please read the new version.`);
  }
  return withTransaction(async (c) => {
    const q = (t, p) => c.query(t, p);
    const pending = await pendingPolicies(vendorId, q);
    const missing = pending.filter((p) => !wanted.some((a) => a.policy === p.slug));
    if (missing.length) throw new Error(`You also need to accept: ${missing.map((p) => p.title).join(', ')}.`);
    for (const p of pending) {
      await q(`INSERT INTO policy_acceptances (vendor_id, policy, version, accepted_by, ip) VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (vendor_id, policy, version) DO NOTHING`, [vendorId, p.slug, p.version, by, ip || null]);
    }
    if (pending.length) await logVendorEvent(q, vendorId, 'policies_accepted', by, { policies: pending.map((p) => `${p.slug}@${p.version}`) });
    return { ok: true, accepted: pending.length };
  });
}
