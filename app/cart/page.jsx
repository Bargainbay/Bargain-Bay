import { getAll } from '../../lib/inventory';
import CartClient from './CartClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your Cart — Bargain Bay' };

export default function CartPage() {
  // Ship the catalog down; the client matches it against localStorage SKUs.
  return <CartClient catalog={getAll()} />;
}
