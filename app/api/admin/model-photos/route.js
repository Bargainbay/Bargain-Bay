// Stock photos by model — list, set (link or upload), remove.
// Staff: it is the selling side's catalogue, same gate as unit photos.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { modelPhotoRows, setModelPhoto, clearModelPhoto } from '../../../../lib/model-photos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function staff() { const s = await getSession(); return s && isStaff(s) ? s : null; }
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  if (!(await staff())) return denied();
  try { return NextResponse.json({ models: await modelPhotoRows() }); }
  catch (e) { return NextResponse.json({ error: e?.message || 'Could not load models.' }, { status: 500 }); }
}

export async function POST(req) {
  const s = await staff();
  if (!s) return denied();
  let form;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 }); }
  const model = String(form.get('model') || '').trim();
  if (!model) return NextResponse.json({ error: 'Missing model' }, { status: 400 });
  try {
    const r = await setModelPhoto(model, { url: form.get('url'), file: form.get('photo') }, { createdBy: s.email || null });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save that photo.' }, { status: 400 });
  }
}

export async function DELETE(req) {
  if (!(await staff())) return denied();
  const model = (new URL(req.url).searchParams.get('model') || '').trim();
  if (!model) return NextResponse.json({ error: 'Missing model' }, { status: 400 });
  try { return NextResponse.json({ ok: true, ...(await clearModelPhoto(model)) }); }
  catch (e) { return NextResponse.json({ error: e?.message || 'Could not remove that photo.' }, { status: 500 }); }
}
