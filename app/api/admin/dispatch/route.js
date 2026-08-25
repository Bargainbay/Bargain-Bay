import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff, validEmail, normalizeEmail } from '../../../../lib/auth';
import { setDriverByEmail } from '../../../../lib/drivers';
import { hasDb } from '../../../../lib/db';
import {
  createJob, assignJob, resequence, setJobStatus, cancelJob,
  upsertClient, importReadyBargainBayOrders, importOneBargainBayOrder, dispatchBoard,
  jobInvoiceForPayment, noteJobEvent,
  setTicketStatus, listTickets,
  findServiceCustomers, ordersForServiceCall,
  completeJob, setJobPay, payReport, bookRevisit,
  setJobCharge, billingSummary, invoiceClientJobs
} from '../../../../lib/jobs';
import { recordInvoicePayment, PAYMENT_METHODS } from '../../../../lib/invoices';

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
  const sp = new URL(req.url).searchParams;
  try {
    // Raising a service call against something we sold: find the buyer, then
    // pick which of their orders needs the visit.
    if (sp.get('view') === 'customers') {
      return NextResponse.json({ customers: await findServiceCustomers(sp.get('q') || '') });
    }
    if (sp.get('view') === 'orders') {
      return NextResponse.json({ orders: await ordersForServiceCall(sp.get('email') || '') });
    }
    if (sp.get('view') === 'billing') {
      return NextResponse.json(await billingSummary({ from: sp.get('from'), to: sp.get('to') }));
    }
    if (sp.get('view') === 'pay') {
      return NextResponse.json(await payReport({ from: sp.get('from'), to: sp.get('to') }));
    }
    if (sp.get('view') === 'tickets') {
      return NextResponse.json(await listTickets({ status: sp.get('status') || 'open_states' }));
    }
    return NextResponse.json(await dispatchBoard(sp.get('date') || ''));
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
    // "Add anyway": one order the pull declined — a pickup that does need a
    // driver, a cancelled job coming back, an order still at Pending payment.
    if (body.action === 'import_order') {
      return NextResponse.json({ ok: true, ...(await importOneBargainBayOrder(body.orderNumber, { by: who(s) })) });
    }
    if (body.action === 'invoice_client') {
      // Raising an invoice is money leaving the building — admin only.
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can invoice a client.' }, { status: 403 });
      return NextResponse.json({ ok: true, ...(await invoiceClientJobs(body.clientId, body, who(s))) });
    }
    if (body.action === 'client') {
      // Open to all staff on purpose. A client is a company name — gating it
      // behind an admin is the exact friction that sends someone back to paper
      // when a new company calls mid-shift.
      return NextResponse.json({ ok: true, client: await upsertClient(body) });
    }
    if (body.action === 'driver') {
      // Making someone a driver IS a permission, so this one stays admin-only.
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can add or remove a driver.' }, { status: 403 });
      const email = normalizeEmail(body.email);
      if (!validEmail(email)) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
      const r = await setDriverByEmail(email, body.on !== false);
      if (!r.ok) return NextResponse.json({ error: r.reason || 'No account with that email — have them sign up first.' }, { status: 400 });
      return NextResponse.json({ ok: true, driver: r.user });
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
    if (body.action === 'revisit') {
      return NextResponse.json({ ok: true, ...(await bookRevisit(body.ticketId, who(s))) });
    }
    if (body.action === 'ticket_status') {
      return NextResponse.json({ ok: true, ticket: await setTicketStatus(body.ticketId, body.status, who(s)) });
    }
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
    // The balance collected at the door, recorded against the order's invoice
    // from the board. Staff-level, like recording a payment on the Invoices page
    // — the person who takes the money has to be the person who can log it, or
    // it gets logged tomorrow from a note in someone's pocket.
    if (body.action === 'record_payment') {
      const target = await jobInvoiceForPayment(jobId);
      const r = await recordInvoicePayment(target.invoiceId, {
        amount: body.amount, method: String(body.method || '').trim(), note: body.note
      });
      await noteJobEvent(
        jobId, 'payment',
        `${PAYMENT_METHODS[String(body.method || '').trim()] || 'Payment'} $${Number(body.amount).toFixed(2)} on ${target.invoiceNumber}`
        + (r.fullyPaid ? ' — paid in full' : ` — $${Number(r.balance).toFixed(2)} still owing`),
        who(s)
      );
      return NextResponse.json({ ok: true, invoice: r, invoiceNumber: target.invoiceNumber });
    }
    if (body.action === 'service_complete' || body.action === 'complete') {
      return NextResponse.json({ ok: true, job: await completeJob(jobId, body, who(s)) });
    }
    if (body.action === 'charge') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can set what a job charges.' }, { status: 403 });
      return NextResponse.json({ ok: true, job: await setJobCharge(jobId, body, who(s)) });
    }
    if (body.action === 'pay') {
      // Money, so admin only — same line the rest of the app draws.
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can set what a job pays.' }, { status: 403 });
      return NextResponse.json({ ok: true, job: await setJobPay(jobId, body, who(s)) });
    }
    if (body.action === 'cancel') {
      return NextResponse.json({ ok: true, job: await cancelJob(jobId, body.reason, who(s)) });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
