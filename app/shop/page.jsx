import { getAvailable, categories, brands } from '../../lib/inventory';
import ShopClient from './ShopClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Shop All Inventory — Bargain Bay' };

export default async function ShopPage({ searchParams }) {
  const units = await getAvailable();
  return (
    <ShopClient
      units={units}
      cats={categories(units)}
      makes={brands(units)}
      initialCollection={searchParams?.collection || ''}
      initialQuery={searchParams?.q || ''}
    />
  );
}
