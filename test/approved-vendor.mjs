// Approval now needs a valid BN + HST account and a recorded CRA registry check (lib/vendors.js).
// Tests that are about something else approve through this, which seeds a well-formed, unique
// identity (only where the vendor has none) and marks it checked. test/vendor-identity.test.mjs
// exercises the real rules and does NOT use this.
import { query } from '../lib/db.js';
import { decideApplication as real } from '../lib/vendors.js';
import { luhnOk } from '../lib/business-ids.js';

export function validBn(n) {
  const base = String(10000000 + n);
  for (let d = 0; d < 10; d++) if (luhnOk(base + d)) return base + d;
}

export async function decideApplication(vendorId, opts) {
  if (opts?.approve && opts?.by) {
    const bn = validBn(Number(vendorId));
    await query(
      `UPDATE vendors SET business_no = COALESCE(business_no, $2), hst_no = COALESCE(hst_no, $3),
              identity_verified_at = COALESCE(identity_verified_at, now()), identity_verified_by = COALESCE(identity_verified_by, 'test')
        WHERE id = $1 AND status = 'applied'`, [vendorId, bn, `${bn}RT0001`]);
  }
  return real(vendorId, opts);
}
