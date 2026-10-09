// Who is this vendor user? Every vendor route starts here and uses the vendor id it
// returns — never an id from the request. See lib/vendors.js `vendorAccess`.
import { getSession } from './auth';
import { vendorAccess } from './vendors';

export async function requireVendor() {
  const session = await getSession();
  if (!session?.email) return null;
  const vendor = await vendorAccess(session.email);
  return vendor ? { session, vendor } : null;
}
