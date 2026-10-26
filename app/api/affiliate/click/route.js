// "Somebody opened an affiliate's link." Public and unauthenticated by nature, so it
// trusts nothing: the code must belong to an approved affiliate, the visitor id is a
// random string the browser made up, bots are ignored, and one visitor on one day is
// one row however many times this is called. It always answers 204 - a visitor is
// never told whether tracking worked.
import { recordClick } from '../../../../lib/affiliates';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const b = await req.json().catch(() => ({}));
    await recordClick(b.code, b.visitor, req.headers.get('user-agent') || '');
  } catch (e) { console.error('affiliate click failed', e?.message || e); }
  return new Response(null, { status: 204 });
}
