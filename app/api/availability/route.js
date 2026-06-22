import { NextResponse } from 'next/server';
import { unavailableSkus } from '../../../lib/reservations';

export const dynamic = 'force-dynamic';

// GET /api/availability?skus=SKU1,SKU2  →  { unavailable: ["SKU2"] }
// Without ?skus= it returns every unavailable SKU (sold or actively reserved).
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get('skus') || '';
  // Cap the input so a caller can't send a gigantic array into the `= ANY($1)`
  // query (memory + DB load). 200 comfortably covers any real storefront page.
  const skus = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
  const blocked = await unavailableSkus(skus.length ? skus : null);
  return NextResponse.json({ unavailable: [...blocked] });
}
