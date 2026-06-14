import { getAvailable, categories, brands } from '../../lib/inventory';
import { COLLECTIONS } from '../../lib/constants';
import ShopClient from './ShopClient';
import specs from '../../data/specs.json';
import { unitKeywords } from '../../lib/keywords';

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
  const enriched = units.map((u) => ({ ...u, kw: unitKeywords(u, specs[u.id]) }));
  return (
    <ShopClient
      units={enriched}
      cats={categories(units)}
      makes={brands(units)}
      initialCollection={searchParams?.collection || ''}
      initialQuery={searchParams?.q || ''}
    />
  );
}
