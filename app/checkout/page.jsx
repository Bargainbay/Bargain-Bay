import { getAll } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import { contactForEmail } from '../../lib/customers';
import { loadAddonOverrides } from '../../lib/addon-prices';
import CheckoutClient from './CheckoutClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout — Bargain Bay' };

export default async function CheckoutPage() {
  const session = await getSession();
  // Returning customers get their last known phone + delivery address
  // prefilled from the client database (best-effort — null for new/guest).
  const prefill = session ? await contactForEmail(session.email) : null;
  const addonOverrides = await loadAddonOverrides();
  return <CheckoutClient catalog={await getAll({ marketplace: true })} session={session} prefill={prefill} addonOverrides={addonOverrides} />;
}
