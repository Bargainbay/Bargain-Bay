// Internal notes on orders and stops, and the extras the crew did that nobody
// assigned. Whoever can use dispatch (sales, the coordinator, the owner) can read
// and write them — it is the customer's sale, not the business's books, and it
// writes no money. Author comes from the session.
import { NextResponse } from 'next/server';
import { dispatchAccess } from '../../../../lib/dispatch-access';
import { hasDb } from '../../../../lib/db';
import { addNote, listNotes, openExtras, setBilled } from '../../../../lib/order-notes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const who = (s) => ({ email: s?.email, name: s?.name });
const fail = (e) => NextResponse.json({ error: e?.message || 'That didn\'t work.' }, { status: 400 });
async function staff() {
  const { session, allowed } = await dispatchAccess();
  return allowed ? session : null;
}

export async function GET(req) {
  const s = await staff();
  if (!s) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return NextResponse.json({ notes: [], extras: [] });
  const sp = new URL(req.url).searchParams;
  if (sp.get('view') === 'extras') return NextResponse.json({ extras: await openExtras() });
  const orderId = Number(sp.get('orderId')) || null;
  const jobId = Number(sp.get('jobId')) || null;
  if (!orderId && !jobId) return NextResponse.json({ error: 'Which order or stop?' }, { status: 400 });
  return NextResponse.json({ notes: await listNotes({ orderId, jobId }) });
}

export async function POST(req) {
  const s = await staff();
  if (!s) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let body;
  try { body = await req.json(); } catch { body = {}; }
  try {
    if (body.action === 'billed') {
      return NextResponse.json({ ok: true, note: await setBilled(body.noteId, body.billed !== false, who(s)) });
    }
    const note = await addNote({
      orderId: body.orderId, jobId: body.jobId, kind: body.kind === 'extra' ? 'extra' : 'note',
      body: body.body, by: who(s), role: 'staff'
    });
    return NextResponse.json({ ok: true, note });
  } catch (e) {
    return fail(e);
  }
}
