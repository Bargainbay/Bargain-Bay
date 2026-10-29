import { NextResponse } from 'next/server';
import { audit } from '../../../../lib/audit';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { listBundles, saveBundle, setBundleActive, deleteBundle } from '../../../../lib/bundles';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// A package price changes what the storefront charges, so this is ADMIN, like coupons.
async function admin() {
  const s = await getSession();
  return s && isAdmin(s) ? s : null;
}
const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  if (!(await admin())) return deny();
  return NextResponse.json({ bundles: await listBundles() });
}

export async function POST(req) {
  const s = await admin();
  if (!s) return deny();
  if (!hasDb()) return NextResponse.json({ error: 'Database not configured (set POSTGRES_URL).' }, { status: 503 });
  let body; try { body = await req.json(); } catch { body = {}; }
  try {
    const id = await saveBundle(body, s.email);
    await audit(s, { action: body.id ? 'bundle.edit' : 'bundle.create', entity: 'bundle', entityId: id, summary: `Package "${body.title}" saved at $${Number(body.price).toFixed(2)}`, detail: { skus: body.skus } });
    return NextResponse.json({ ok: true, bundles: await listBundles() });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save that package.' }, { status: 400 });
  }
}

export async function PATCH(req) {
  const s = await admin();
  if (!s) return deny();
  let body; try { body = await req.json(); } catch { body = {}; }
  const id = parseInt(body.id, 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  await setBundleActive(id, !!body.active);
  await audit(s, { action: 'bundle.toggle', entity: 'bundle', entityId: id, summary: `Package ${id} ${body.active ? 'switched on' : 'switched off'}` });
  return NextResponse.json({ ok: true, bundles: await listBundles() });
}

export async function DELETE(req) {
  const s = await admin();
  if (!s) return deny();
  const id = parseInt(new URL(req.url).searchParams.get('id'), 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  await deleteBundle(id);
  await audit(s, { action: 'bundle.delete', entity: 'bundle', entityId: id, summary: `Package ${id} deleted` });
  return NextResponse.json({ ok: true, bundles: await listBundles() });
}
