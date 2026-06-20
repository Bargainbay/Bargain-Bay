import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getSession, isAdmin } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Admin tool: re-host a PRIVATE, signed inspection photo into the PUBLIC Blob
// store so storefront cards + the Merchant feed can load it. The signed Supabase
// URL is fetchable server-side without the inspection app's cookies once minted.
//
// Body: { url, key }  (key = stable Blob path segment — use the SKU or inspection
// id so re-runs overwrite the same object instead of piling up copies).
// Returns: { ok, publicUrl, bytes, contentType }.
export async function POST(req) {
  const s = await getSession();
  if (!s || !isAdmin(s)) {
    return NextResponse.json({ error: 'Not authorized — log in with an admin account first.' }, { status: 403 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'BLOB_READ_WRITE_TOKEN is not set.' }, { status: 503 });
  }
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'JSON body required' }, { status: 400 }); }
  const url = String(body.url || '').trim();
  const key = String(body.key || body.sku || '').trim().replace(/[^\w.-]/g, '_');
  if (!/^https?:\/\//i.test(url) || !key) {
    return NextResponse.json({ error: 'Both `url` (http) and `key` are required.' }, { status: 400 });
  }
  try {
    const r = await fetch(url);
    if (!r.ok) return NextResponse.json({ error: `Source fetch failed: ${r.status}` }, { status: 502 });
    const contentType = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    const res = await put(`products/${key}.jpg`, buf, {
      access: 'public',
      addRandomSuffix: false,   // stable, key-addressed path = idempotent re-runs
      contentType,
    });
    return NextResponse.json({ ok: true, publicUrl: res.url, bytes: buf.length, contentType });
  } catch (e) {
    console.error('rehost failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'rehost failed' }, { status: 500 });
  }
}
