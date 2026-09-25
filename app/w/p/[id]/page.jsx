import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// What an ordinary phone camera opens when it is pointed at a parts label. The
// label carries a URL rather than a bare part number for exactly this — see
// lib/location-codes.js — and it carries the part's ID, because a part number is
// allowed to be blank or to be corrected later.
//
// It lands on the OFFICE's parts screen, which is admin-only. That is the same
// deal the unit stickers already have (`/w/u/` opens the staff warehouse page),
// and it is deliberate: the refurb floor works in RS Ops, and /admin/parts says
// so in as many words when it turns somebody away.
export default async function PartSticker({ params }) {
  const { id } = await params;
  let value = String(id || '');
  try { value = decodeURIComponent(value); } catch { /* already decoded */ }
  redirect(`/admin/parts?part=${encodeURIComponent(value)}`);
}
