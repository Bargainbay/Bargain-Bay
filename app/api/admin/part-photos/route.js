// Photos of a part - list, add, remove. Admin only, like the rest of /admin/parts.
// The floor adds through /api/ops/parts (action add_photos).
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { addPartPhotos, listPartPhotos, deletePartPhoto } from '../../../../lib/part-photos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function admin() { const s = await getSession(); return s && isAdmin(s) ? s : null; }
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET(req) {
  if (!(await admin())) return denied();
  const id = Number(new URL(req.url).searchParams.get('partId'));
  if (!id) return NextResponse.json({ error: 'Missing partId' }, { status: 400 });
  return NextResponse.json({ photos: await listPartPhotos(id) });
}

export async function POST(req) {
  const s = await admin();
  if (!s) return denied();
  let form;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 }); }
  try {
    const out = await addPartPhotos(form.get('partId'), form.getAll('photos'), { createdBy: s.email });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) { return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 400 }); }
}

export async function DELETE(req) {
  if (!(await admin())) return denied();
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  return NextResponse.json(await deletePartPhoto(id));
}
