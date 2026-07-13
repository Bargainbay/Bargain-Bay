import { getAll } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import { contactForEmail } from '../../lib/customers';
import CheckoutClient from './CheckoutClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout — Bargain Bay' };

export default async function CheckoutPage() {
  const session = await getSession();
  // Returning customers get their last known phone + delivery address
  // prefilled from the client database (best-effort — null for new/guest).
  const prefill = session ? await contactForEmail(session.email) : null;
  return <CheckoutClient catalog={await getAll()} session={session} prefill={prefill} />;
}
