import { getAll } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import { decorate } from '../../lib/pricing';
import CartClient from './CartClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your Cart — Bargain Bay' };

export default async function CartPage() {
  // Ship the (viewer-priced) catalog down; the client matches it against localStorage SKUs.
  const session = await getSession();
  const catalog = await decorate(getAll(), session);
  const member = catalog.some((u) => u.isMemberPrice);
  return <CartClient catalog={catalog} member={member} />;
}
