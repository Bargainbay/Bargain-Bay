import { getAvailable, categories, brands } from '../../lib/inventory';
import { COLLECTIONS } from '../../lib/constants';
import ShopClient from './ShopClient';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }) {
  const col = COLLECTIONS.find((c) => c.slug === searchParams?.collection);
  const label = col ? col.label : 'Shop All Inventory';
  return {
    title: `${label} — Tested & Working`,
    description: `${label} at liquidation prices — tested & working, one-year warranty, in stock now. Pickup, delivery & freight serving Hamilton, Scarborough and the GTA.`
  };
}

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
