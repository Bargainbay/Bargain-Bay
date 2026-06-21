import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getSession, isAdmin } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Admin tool: re-host a PRIVATE, signed inspection photo into the Blob store
// (the store is private-access). It's then served publicly via /api/photo/<key>,
// which streams the private blob — so cards + the Merchant feed get a stable
// public URL on our own domain without exposing the blob store.
// Body: { url, key }  (key = SKU or inspection id; stable, key-addressed path).
// Returns: { ok, pathname, publicUrl, bytes, contentType }.
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
      access: 'private',
      addRandomSuffix: false,   // stable, key-addressed path
      allowOverwrite: true,     // idempotent re-runs replace the same object
      contentType,
    });
    return NextResponse.json({ ok: true, pathname: res.pathname, publicUrl: `/api/photo/${key}`, bytes: buf.length, contentType });
  } catch (e) {
    console.error('rehost failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'rehost failed' }, { status: 500 });
  }
}
