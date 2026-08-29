import { NextResponse } from 'next/server';
import { getSession, isAdmin, isStaff, validEmail, normalizeEmail } from '../../../../lib/auth';
import {
  setDriverByEmail, addDriverByPhone, createDriverSignInLink,
  listDriversForOffice, driverSmsNumber, changeDriverPhone, mergeDrivers
} from '../../../../lib/drivers';
import { markOrderDeliveredForJob } from '../../../../lib/driver-jobs';
import {
  profitReport, stopTimes, addExpense, listExpenses, deleteExpense, EXPENSE_KINDS
} from '../../../../lib/dispatch-money';
import {
  shiftReport, mileageReport, listVehicles, upsertVehicle
} from '../../../../lib/shifts';
import { livePositions, driverTrail } from '../../../../lib/driver-location';
import { sendSms, smsConfigured } from '../../../../lib/sms';
import { SITE_URL } from '../../../../lib/site';
import { hasDb } from '../../../../lib/db';
import { getSetting, setSetting } from '../../../../lib/settings';
import {
  createJob, assignJob, resequence, setJobStatus, cancelJob,
  upsertClient, importReadyBargainBayOrders, importOneBargainBayOrder, dispatchBoard,
  jobInvoiceForPayment, noteJobEvent,
  setTicketStatus, listTickets, reopenJob, updateJob,
  findServiceCustomers, ordersForServiceCall,
  completeJob, setJobPay, payReport, bookRevisit, setJobTimes,
  setJobCharge, setJobsClient, billingSummary, invoiceClientJobs, crewLost, jobHistory
} from '../../../../lib/jobs';
import { recordInvoicePayment, PAYMENT_METHODS } from '../../../../lib/invoices';
import {
  stageBatch, resolveBatch, patchBatch, setBatchClient, approveBatch, cancelBatch,
  listOpenBatches, addClientAlias, openQuestions
} from '../../../../lib/import-batches';
import { startImportCall, callConfigured, callTarget } from '../../../../lib/import-call';

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
    // What the delivery side made, against what it cost. Admin only — it is the
    // one screen that puts what we charge and what we pay side by side.
    if (sp.get('view') === 'profit') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can see the delivery P&L.' }, { status: 403 });
      return NextResponse.json({
        ...(await profitReport({ from: sp.get('from'), to: sp.get('to'), group: sp.get('group') })),
        kinds: EXPENSE_KINDS
      });
    }
    // The clock on every stop: when they got there, when they finished, and the
    // two things worth chasing — no times at all, and never clocked out.
    if (sp.get('view') === 'times') {
      return NextResponse.json(await stopTimes({
        from: sp.get('from'), to: sp.get('to'), driverId: sp.get('driverId')
      }));
    }
    if (sp.get('view') === 'expenses') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can see costs.' }, { status: 403 });
      return NextResponse.json({
        expenses: await listExpenses({ from: sp.get('from'), to: sp.get('to') }), kinds: EXPENSE_KINDS
      });
    }
    // Everything that has ever happened to one stop. There was no way to look
    // this up, which is why "his name got erased and I don't know how" had no
    // answer — job_events had recorded it all along and nothing rendered it.
    if (sp.get('view') === 'history') {
      return NextResponse.json({ events: await jobHistory(sp.get('jobId')) });
    }
    // A staged sheet, and what it still needs answered. Readable from anywhere,
    // which is the point of staging it — the tab it was uploaded in is not the
    // only place the review can happen.
    if (sp.get('view') === 'import') {
      const batch = await resolveBatch(sp.get('batchId'));
      if (!batch) return NextResponse.json({ error: 'That import is no longer here.' }, { status: 404 });
      return NextResponse.json({ batch, questions: openQuestions(batch) });
    }
    if (sp.get('view') === 'imports') {
      return NextResponse.json({
        batches: await listOpenBatches({ limit: sp.get('limit') }),
        // Whether the Import tab can offer "ring me about it", and where it
        // would ring. Both are needed to decide what to render: configured but
        // with no number set is a button that would fail on the press.
        call: { configured: callConfigured(), to: await callTarget() }
      });
    }
    // Stops where somebody came off the crew without anyone assigning them off.
    if (sp.get('view') === 'crew_lost') {
      return NextResponse.json(await crewLost({ from: sp.get('from'), to: sp.get('to') }));
    }
    // The day AROUND the stops: who clocked on, for how long, and how far the
    // van went. Deliberately separate from the pay report's "hours on site" —
    // shift hours are what a person is paid for, time on site is what a delivery
    // costs, and adding them up would be wrong in both directions.
    if (sp.get('view') === 'shifts') {
      return NextResponse.json(await shiftReport({
        from: sp.get('from'), to: sp.get('to'), driverId: sp.get('driverId')
      }));
    }
    if (sp.get('view') === 'mileage') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can see running costs.' }, { status: 403 });
      return NextResponse.json(await mileageReport({ from: sp.get('from'), to: sp.get('to') }));
    }
    if (sp.get('view') === 'review_link') {
      return NextResponse.json({ url: (await getSetting('google_review_url', '')) || '' });
    }
    if (sp.get('view') === 'vehicles') {
      return NextResponse.json({ vehicles: await listVehicles({ includeInactive: true }) });
    }
    // Where the vans are. Staff, not admin: this is the dispatcher's job, and
    // it is the same information they already get by ringing the driver.
    if (sp.get('view') === 'live') {
      return NextResponse.json(await livePositions());
    }
    if (sp.get('view') === 'trail') {
      return NextResponse.json({ trail: await driverTrail(sp.get('driverId'), { date: sp.get('date') }) });
    }
    if (sp.get('view') === 'drivers') {
      return NextResponse.json({ drivers: await listDriversForOffice() });
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
    // A client's spreadsheet, as stops. The rows have already been previewed by
    // whoever pasted them; this re-validates every one anyway, because a payload
    // is a payload no matter which screen it came from.
    if (body.action === 'import_stops') {
      const stops = Array.isArray(body.stops) ? body.stops.slice(0, 300) : [];
      if (!stops.length) return NextResponse.json({ error: 'Nothing to import.' }, { status: 400 });
      const created = [];
      const failed = [];
      for (const stop of stops) {
        try {
          const job = await createJob({ ...stop, source: 'import', createdBy: who(s) });
          created.push({ job: job.jobNumber, customerName: stop.customerName || null });
        } catch (e) {
          // One bad row must not cost the other twenty-nine.
          failed.push({ customerName: stop.customerName || null, address: stop.address || null, error: e?.message || 'could not be added' });
        }
      }
      return NextResponse.json({ ok: true, added: created.length, created, failed });
    }
    // ── Staged imports ──────────────────────────────────────────────────────
    // A sheet is STAGED first and approved second, so the review can happen
    // somewhere other than the tab it was uploaded in — including over the
    // phone. Nothing here puts a stop on the board except `import_approve`.
    if (body.action === 'stage_import') {
      const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
      const batch = await stageBatch({
        headers: Array.isArray(body.headers) ? body.headers : [],
        rows,
        sourceName: body.sourceName,
        readAs: body.readAs || 'paste',
        jobDate: body.jobDate || null,
        clientId: body.clientId || null,
        createdBy: who(s)
      });
      return NextResponse.json({ ok: true, batch, questions: openQuestions(batch) });
    }
    if (body.action === 'import_patch') {
      const batch = await patchBatch(body.batchId, body.patch || {}, who(s));
      return NextResponse.json({ ok: true, batch, questions: openQuestions(batch) });
    }
    // "This whole sheet is for X" — the one that answers a day of stops filed
    // under the wrong company one card at a time.
    if (body.action === 'import_client') {
      const batch = await setBatchClient(body.batchId, body.clientId, { everyRow: body.everyRow !== false });
      return NextResponse.json({ ok: true, batch, questions: openQuestions(batch) });
    }
    if (body.action === 'import_alias') {
      await addClientAlias(body.clientId, body.alias, who(s));
      const batch = body.batchId ? await resolveBatch(body.batchId) : null;
      return NextResponse.json({ ok: true, batch, questions: batch ? openQuestions(batch) : [] });
    }
    // "Ring me and read it to me." The number is NOT taken from the request —
    // a review call that can be pointed at an arbitrary number is a robocaller
    // with our name on it. It is an env var or a setting, and nothing else.
    if (body.action === 'import_call') {
      if (!callConfigured()) {
        return NextResponse.json({ error: 'Calling is not set up on this deployment.' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, ...(await startImportCall(body.batchId, { by: who(s) })) });
    }
    if (body.action === 'call_number') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can set the number dispatch rings.' }, { status: 403 });
      const raw = String(body.number || '').trim();
      // E.164 only. A number the phone system can't dial is a call that fails
      // silently at Twilio rather than on the screen somebody is looking at.
      if (raw && !/^\+[1-9]\d{7,14}$/.test(raw)) {
        return NextResponse.json({ error: 'Give it as +1 then the ten digits, e.g. +14165551234.' }, { status: 400 });
      }
      await setSetting('dispatch_call_to', raw.slice(0, 20));
      return NextResponse.json({ ok: true, number: raw });
    }
    if (body.action === 'import_approve') {
      return NextResponse.json({ ok: true, ...(await approveBatch(body.batchId, who(s))) });
    }
    if (body.action === 'import_cancel') {
      return NextResponse.json({ ok: true, batch: await cancelBatch(body.batchId, who(s)) });
    }
    // "Add anyway": one order the pull declined — a pickup that does need a
    // driver, a cancelled job coming back, an order still at Pending payment.
    if (body.action === 'import_order') {
      return NextResponse.json({ ok: true, ...(await importOneBargainBayOrder(body.orderNumber, {
        by: who(s), address: body.address, city: body.city, postal: body.postal
      })) });
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
    // Add a driver from a name and a mobile number, and text them the link that
    // signs their phone in. No account for them to create, no password for them
    // to forget — that friction is exactly what kept drivers on paper.
    if (body.action === 'driver_phone' || body.action === 'driver_link') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can add or remove a driver.' }, { status: 403 });
      let d;
      try {
        d = body.action === 'driver_phone'
          ? await addDriverByPhone({ name: body.name, phone: body.phone, force: body.force === true })
          : (await listDriversForOffice()).find((x) => x.id === Number(body.driverId));
      } catch (e) {
        // A name we already have is not an error to shrug at: the page has to be
        // able to offer the change-number button instead of the add button.
        if (e?.code === 'DRIVER_NAME_TAKEN') {
          return NextResponse.json({ error: e.message, code: e.code, driver: e.driver }, { status: 409 });
        }
        throw e;
      }
      if (!d) return NextResponse.json({ error: 'No such driver.' }, { status: 400 });

      const { token } = await createDriverSignInLink(d.id);
      // The link must point at the dispatch host, not the storefront: an RS
      // Solutions driver following a bargainbay.ca link is the brand leak the
      // separate domain exists to prevent.
      const base = process.env.RS_SITE_URL || `https://${(process.env.DISPATCH_HOSTS || 'dispatch.rssolutions.ca').split(',')[0].trim()}` || SITE_URL;
      const url = `${base.replace(/\/$/, '')}/d/${token}`;
      const host = base.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const text = `RS Solutions - your stops: ${url}\n`
        + `Lost this text? Go to ${host}/driver and sign in with your mobile number.`;

      let sms = { ok: false, skipped: true };
      if (d.phone) sms = await sendSms({ to: driverSmsNumber(d.phone), body: text });
      // The link is ALWAYS returned so the office can read it out or paste it
      // into WhatsApp when Twilio is unconfigured or a send fails — a driver
      // must never be stuck because a text didn't land.
      return NextResponse.json({
        ok: true, driver: d, url,
        texted: !!sms.ok,
        smsConfigured: smsConfigured(),
        smsError: sms.ok ? null : (sms.error || sms.reason || null)
      });
    }
    // A driver's new phone. The account, and everything hanging off it, stays.
    if (body.action === 'driver_rephone') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can change a driver’s number.' }, { status: 403 });
      try {
        const driver = await changeDriverPhone(body.driverId, body.phone);
        return NextResponse.json({ ok: true, driver });
      } catch (e) {
        if (e?.code === 'PHONE_TAKEN') {
          return NextResponse.json({ error: e.message, code: e.code, driver: e.driver }, { status: 409 });
        }
        throw e;
      }
    }
    // The repair for a driver who was already added twice.
    if (body.action === 'driver_merge') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can merge driver accounts.' }, { status: 403 });
      return NextResponse.json({ ok: true, ...(await mergeDrivers(body.keepId, body.dropId)) });
    }
    // Gas, and anything else the day cost that isn't attached to one stop.
    if (body.action === 'expense') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can record costs.' }, { status: 403 });
      return NextResponse.json({ ok: true, expense: await addExpense(body, who(s)) });
    }
    if (body.action === 'delete_expense') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can remove a cost.' }, { status: 403 });
      return NextResponse.json({ ok: true, ...(await deleteExpense(body.id)) });
    }
    // A van. Staff-level like a client — it is a name for a truck, not an
    // access grant — and the odometer readings are meaningless without it.
    // The Google review link the driver's QR code points at. Admin — it is the
    // address customers are sent to, and a wrong one sends every review of the
    // month somewhere else.
    if (body.action === 'review_link') {
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can set the review link.' }, { status: 403 });
      const raw = String(body.url || '').trim();
      if (raw && !/^https:\/\/\S+$/i.test(raw)) {
        return NextResponse.json({ error: 'Paste the full https:// link from Google.' }, { status: 400 });
      }
      await setSetting('google_review_url', raw.slice(0, 500));
      return NextResponse.json({ ok: true, url: raw });
    }
    if (body.action === 'vehicle') {
      return NextResponse.json({ ok: true, vehicle: await upsertVehicle(body) });
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
      const job = await setJobStatus(jobId, body.status, body, who(s));
      // The office finishing a stop has to mean what the driver's Done means.
      // It didn't: the board could mark a delivery done and the Bargain Bay
      // order behind it stayed 'out for delivery' — no delivered email, no
      // units in the sold ledger — because only the phone ever called this.
      // Idempotent, best-effort, and a no-op on a job with no order.
      if (body.status === 'done') markOrderDeliveredForJob(jobId).catch(() => {});
      return NextResponse.json({ ok: true, job });
    }
    // The times, typed in. A driver who forgets to tap Done leaves a stop with
    // no finish time, and the office has been closing those out at whatever
    // moment they noticed — which recorded a two-hour delivery as a five-hour
    // one. The real times are in the WhatsApp group; this is where they land.
    if (body.action === 'times') {
      const job = await setJobTimes(jobId, body, who(s));
      if (job.status === 'done' && body.markDone === true) markOrderDeliveredForJob(jobId).catch(() => {});
      return NextResponse.json({ ok: true, job });
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
    // Whose work a stop is, on many stops at once. Staff — a client is a company
    // name, the same gate that lets staff add one from inside the job form.
    if (body.action === 'client_bulk') {
      return NextResponse.json({ ok: true, ...(await setJobsClient(body.jobIds, body.clientId, who(s))) });
    }
    if (body.action === 'pay') {
      // Money, so admin only — same line the rest of the app draws.
      if (!isAdmin(s)) return NextResponse.json({ error: 'Only an admin can set what a job pays.' }, { status: 403 });
      return NextResponse.json({ ok: true, job: await setJobPay(jobId, body, who(s)) });
    }
    // Putting a closed stop back on the board — the counterpart to Cancel and
    // to a driver tapping Done on the wrong card.
    // Correcting a job that already exists — name, phone, address, what's on it.
    // Staff, like creating one: whoever takes the call that says "actually we've
    // moved" has to be able to fix it while the customer is still talking.
    if (body.action === 'edit') {
      // The edit form carries a charge box, and updateJob now honours it — so the
      // money gate has to be applied HERE, where every other money gate is.
      // Editing a job is staff-level on purpose; setting what a client is charged
      // is not, and routing it through a staff action would quietly widen it.
      const patch = isAdmin(s) ? body : { ...body, chargeAmount: undefined };
      return NextResponse.json({ ok: true, job: await updateJob(jobId, patch, who(s)) });
    }
    if (body.action === 'reopen') {
      return NextResponse.json({ ok: true, job: await reopenJob(jobId, who(s)) });
    }
    if (body.action === 'cancel') {
      return NextResponse.json({ ok: true, job: await cancelJob(jobId, body.reason, who(s)) });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
