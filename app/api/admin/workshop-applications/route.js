// Workshop applications board. STAFF-level: it is people we are talking to about a course, not the business's books.
import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../lib/auth';
import { listApplications, listNotes, setStatus, setSpoken, addNote, WorkshopError } from '../../../../lib/workshop-applications';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function viewerOf() {
  const s = await getSession();
  return s && isStaff(s) ? { email: s.email, name: s.name } : null;
}
const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });
const fail = (e) => NextResponse.json({ error: e instanceof WorkshopError ? e.message : 'Something went wrong. Try again.' }, { status: e instanceof WorkshopError ? (e.code === 'missing' ? 404 : 400) : 500 });

export async function GET(req) {
  if (!(await viewerOf())) return deny();
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (id) return NextResponse.json({ notes: await listNotes(id) });
    return NextResponse.json({ applications: await listApplications() });
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  const v = await viewerOf();
  if (!v) return deny();
  let b; try { b = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  try {
    switch (b.action) {
      case 'status': return NextResponse.json(await setStatus(b.ids || b.id, b.status));
      case 'junk': return NextResponse.json(await setStatus(b.ids || b.id, 'junk'));
      case 'spoken': return NextResponse.json(await setSpoken(b.id, b.spoken === true, v));
      case 'note': return NextResponse.json(await addNote(b.id, { kind: b.kind, body: b.body }, v));
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) { return fail(e); }
}
