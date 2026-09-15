import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// What an ordinary phone camera opens when it is pointed at a unit sticker. The
// sticker carries a URL rather than a bare SKU for exactly this — see
// lib/location-codes.js. The warehouse page does the sign-in check.
export default async function UnitSticker({ params }) {
  const { sku } = await params;
  let value = String(sku || '');
  try { value = decodeURIComponent(value); } catch { /* already decoded */ }
  redirect(`/admin/warehouse?unit=${encodeURIComponent(value)}`);
}
