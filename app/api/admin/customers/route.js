// Client database admin API. GET = search/list, PATCH = edit a customer's
// contact details / notes, POST {action:'rebuild'} = re-sweep all history.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { listCustomers, updateCustomerDetails, backfillCustomers } from '../../../../lib/customers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function gate() {
  const s = await getSession();
  return s && isAdmin(s) ? null : NextResponse.json({ error: 'Not authorized' }, { status: 403 });
}

export async function GET(req) {
  const denied = await gate();
  if (denied) return denied;
  const q = new URL(req.url).searchParams.get('q') || '';
  try {
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
  if (body.action !== 'rebuild') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  try {
    return NextResponse.json(await backfillCustomers());
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Rebuild failed.' }, { status: 500 });
  }
}
