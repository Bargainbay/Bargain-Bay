import { getAll } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import CheckoutClient from './CheckoutClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Checkout — Bargain Bay' };

export default async function CheckoutPage() {
  const session = await getSession();
  return <CheckoutClient catalog={getAll()} session={session} />;
}
