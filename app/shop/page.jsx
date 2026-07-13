import { getAvailable, categories, brands } from '../../lib/inventory';
import { getSession } from '../../lib/auth';
import { decorate } from '../../lib/pricing';
import { COLLECTIONS } from '../../lib/constants';
import ShopClient from './ShopClient';
import specs from '../../data/specs.json';
import { unitKeywords } from '../../lib/keywords';
import { styleFor } from '../../lib/styles';

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
  const units = await decorate(await getAvailable(), await getSession());
  const enriched = units.map((u) => ({
    ...u,
    kw: unitKeywords(u, specs[u.id]),
    // Subcategory ("type") for the shop filter — French Door, Front Load, etc.
    style: styleFor(u, specs[u.id])
  }));
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
