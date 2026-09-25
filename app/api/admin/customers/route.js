// Client database admin API. GET = search/list, PATCH = edit a customer's
// contact details / notes, POST {action:'rebuild'} = re-sweep all history.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import {
  listCustomers, updateCustomerDetails, backfillCustomers,
  mergeCustomers, duplicateCandidates
} from '../../../../lib/customers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function gate() {
  const s = await getSession();
  return s && isAdmin(s) ? null : NextResponse.json({ error: 'Not authorized' }, { status: 403 });
}

export async function GET(req) {
  const denied = await gate();
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const q = sp.get('q') || '';
  try {
    // Records that LOOK like the same person. Proposed, never merged — a
    // household shares a phone, two people share a name, and a merge cannot be
    // undone: the other record is deleted and its identities move.
    if (sp.get('duplicates')) {
      return NextResponse.json({ duplicates: await duplicateCandidates({}) });
    }
    return NextResponse.json({ customers: await listCustomers({ q }) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not load customers.' }, { status: 500 });
  }
}

export async function PATCH(req) {
  const denied = await gate();
  if (denied) return denied;
  let body;
  try { body = await req.json(); } catch { body = {}; }
  if (!Number(body.id)) return NextResponse.json({ error: 'Missing customer id' }, { status: 400 });
  try {
    await updateCustomerDetails(body.id, body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 500 });
  }
}

export async function POST(req) {
  const denied = await gate();
  if (denied) return denied;
  let body;
  try { body = await req.json(); } catch { body = {}; }
  if (body.action === 'merge') {
    const session = await getSession();
    try {
      // keep / drop are explicit rather than inferred from which is "better".
      // Which record survives decides which email a customer keeps hearing
      // from, and that is a judgement, not an ordering.
      return NextResponse.json(
        await mergeCustomers(body.keep, body.drop, { by: session?.email || null })
      );
    } catch (e) {
      return NextResponse.json({ error: e?.message || 'Merge failed.' }, { status: 400 });
    }
  }
  if (body.action !== 'rebuild') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  try {
    return NextResponse.json(await backfillCustomers());
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Rebuild failed.' }, { status: 500 });
  }
}
