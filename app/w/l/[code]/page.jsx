import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// What an ordinary phone camera opens when it is pointed at a spot label — the
// list of what is recorded in that spot. See lib/location-codes.js.
export default async function SpotLabel({ params }) {
  const { code } = await params;
  let value = String(code || '');
  try { value = decodeURIComponent(value); } catch { /* already decoded */ }
  redirect(`/admin/warehouse?loc=${encodeURIComponent(value)}`);
}
