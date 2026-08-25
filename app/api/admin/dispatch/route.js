import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import {
  createJob, assignJob, resequence, setJobStatus, cancelJob,
  upsertClient, importReadyBargainBayOrders, dispatchBoard
} from '../../../../lib/jobs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Dispatch is open to all back-office staff, not admins only: the whole point is
// that whoever picks up the phone can put the job on the board while the customer
// is still talking. (Everything money-sensitive stays isAdmin — see CLAUDE.md.)
async function staff() {
  const s = await getSession();
  return s && isStaff(s) ? s : null;
}

const who = (s) => ({ email: s?.email, name: s?.name });
const noDb = () => NextResponse.json({ error: 'Database not configured (set POSTGRES_URL).' }, { status: 503 });
const fail = (e) => NextResponse.json({ error: e?.message || 'Something went wrong.' }, { status: 400 });

export async function GET(req) {
  const s = await staff();
  if (!s) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();
  const date = new URL(req.url).searchParams.get('date') || '';
  try {
    return NextResponse.json(await dispatchBoard(date));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req) {
  const s = await staff();
  if (!s) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();
  let body;
  try { body = await req.json(); } catch { body = {}; }

  try {
    if (body.action === 'import_bb') {
      return NextResponse.json({ ok: true, ...(await importReadyBargainBayOrders({ by: who(s) })) });
    }
    if (body.action === 'client') {
      // Adding a client is an owner-level decision, not a per-job one.
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can add or edit a client.' }, { status: 403 });
      return NextResponse.json({ ok: true, client: await upsertClient(body) });
    }
    const job = await createJob({ ...body, createdBy: who(s) });
    return NextResponse.json({ ok: true, job });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req) {
  const s = await staff();
  if (!s) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  if (!hasDb()) return noDb();
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const jobId = Number(body.jobId);

  try {
    if (body.action === 'resequence') {
      return NextResponse.json({ ok: true, ...(await resequence(body.driverId, body.date, body.jobIds, who(s))) });
    }
    if (!jobId) return NextResponse.json({ error: 'jobId is required.' }, { status: 400 });
    if (body.action === 'assign') {
      return NextResponse.json({ ok: true, job: await assignJob(jobId, body, who(s)) });
    }
    if (body.action === 'status') {
      return NextResponse.json({ ok: true, job: await setJobStatus(jobId, body.status, body, who(s)) });
    }
    if (body.action === 'cancel') {
      return NextResponse.json({ ok: true, job: await cancelJob(jobId, body.reason, who(s)) });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
