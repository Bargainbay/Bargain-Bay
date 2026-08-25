import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getSession } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';
import { isDriver, touchDriverSeen } from '../../../../lib/drivers';
import {
  driverJobs, jobBelongsToDriver, podAlreadyRecorded,
  saveJobSignature, addJobPhoto, markOrderDeliveredForJob
} from '../../../../lib/driver-jobs';
import { setJobStatus, completeJob, jobInvoiceForPayment, noteJobEvent } from '../../../../lib/jobs';
import { recordInvoicePayment, PAYMENT_METHODS } from '../../../../lib/invoices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Everything the driver's phone talks to. One route: the app is a stop list and
// three verbs, and a driver in a basement retrying a request should be retrying
// one shape of request.
async function driver() {
  const s = await getSession();
  if (!s || !hasDb()) return null;
  return (await isDriver(s)) ? s : null;
}
const who = (s) => ({ email: s?.email, name: s?.name });
const nope = () => NextResponse.json({ error: 'Not a driver account.' }, { status: 403 });
const fail = (e) => NextResponse.json({ error: e?.message || 'That didn\'t work.' }, { status: 400 });

export async function GET(req) {
  const s = await driver();
  if (!s) return nope();
  const date = new URL(req.url).searchParams.get('date') || '';
  touchDriverSeen(s.userId).catch(() => {});
  try {
    return NextResponse.json({ ...(await driverJobs(s.userId, { date })), driver: { name: s.name || '' } });
  } catch (e) {
    return fail(e);
  }
}

// Start / arrive / couldn't-complete, and the balance taken at the door.
// Deliberately idempotent: the phone queues these when there's no signal and
// replays them later, and the same "arrived" arriving twice must be a no-op.
export async function PATCH(req) {
  const s = await driver();
  if (!s) return nope();
  let body;
  try { body = await req.json(); } catch { body = {}; }
  const jobId = Number(body.jobId);
  if (!jobId) return NextResponse.json({ error: 'Which stop?' }, { status: 400 });
  if (!(await jobBelongsToDriver(jobId, s.userId))) {
    return NextResponse.json({ error: 'That stop is not assigned to you.' }, { status: 403 });
  }

  try {
    if (body.action === 'status') {
      const { rows } = await query('SELECT status FROM jobs WHERE id = $1', [jobId]);
      // Replay of something already done, or of a step the stop has moved past:
      // report success rather than an error the driver can do nothing about.
      if (['done', 'failed'].includes(rows[0]?.status)) {
        return NextResponse.json({ ok: true, alreadyClosed: true });
      }
      if (rows[0]?.status === body.status) return NextResponse.json({ ok: true, unchanged: true });
      const job = await setJobStatus(jobId, body.status, body, who(s));
      return NextResponse.json({ ok: true, job });
    }
    if (body.action === 'payment') {
      const target = await jobInvoiceForPayment(jobId);
      const r = await recordInvoicePayment(target.invoiceId, {
        amount: body.amount, method: String(body.method || '').trim(), note: body.note
      });
      await noteJobEvent(
        jobId, 'payment',
        `${PAYMENT_METHODS[String(body.method || '').trim()] || 'Payment'} $${Number(body.amount).toFixed(2)} `
        + `collected at the door on ${target.invoiceNumber}`
        + (r.fullyPaid ? ' — paid in full' : ` — $${Number(r.balance).toFixed(2)} still owing`),
        who(s)
      );
      return NextResponse.json({ ok: true, balance: r.balance, fullyPaid: !!r.fullyPaid });
    }
    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}

// Finishing a stop: signature (+ photos) to the private Blob store, then the
// completion itself. Multipart because it carries images.
export async function POST(req) {
  const s = await driver();
  if (!s) return nope();

  let form;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 }); }
  const jobId = Number(form.get('jobId'));
  const ref = String(form.get('ref') || '').slice(0, 80);
  if (!jobId) return NextResponse.json({ error: 'Which stop?' }, { status: 400 });
  if (!(await jobBelongsToDriver(jobId, s.userId))) {
    return NextResponse.json({ error: 'That stop is not assigned to you.' }, { status: 403 });
  }
  // The offline queue can send the same completion twice. The second one is
  // answered, not written — otherwise a lost signal costs the customer a
  // duplicate set of photos and the office a duplicate stop history.
  if (ref && await podAlreadyRecorded(jobId, ref)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const { rows: j } = await query('SELECT job_number, type FROM jobs WHERE id = $1', [jobId]);
  if (!j.length) return NextResponse.json({ error: 'That stop no longer exists.' }, { status: 404 });

  const signature = form.get('signature');
  const photos = form.getAll('photos').filter((f) => f && typeof f === 'object' && f.size > 0);

  try {
    const base = `pod/jobs/${j[0].job_number}`;
    if (signature && typeof signature === 'object' && signature.size) {
      const sig = await put(`${base}/signature.png`, signature, {
        access: 'private', addRandomSuffix: true, contentType: 'image/png'
      });
      await saveJobSignature(jobId, sig.pathname, ref);
    } else if (ref) {
      // No signature (a threshold drop nobody was home to sign for) still needs
      // the ref recorded, or a replay writes the photos a second time.
      await saveJobSignature(jobId, null, ref);
    }
    for (let i = 0; i < photos.length && i < 8; i++) {
      const p = photos[i];
      const r = await put(`${base}/photo-${i}.jpg`, p, {
        access: 'private', addRandomSuffix: true, contentType: p.type || 'image/jpeg'
      });
      await addJobPhoto(jobId, r.url, r.pathname);
    }

    const job = await completeJob(jobId, {
      timeIn: form.get('timeIn') || null,
      timeOut: form.get('timeOut') || null,
      outcome: form.get('outcome') || null,
      partsUsed: form.get('partsUsed') || null,
      partsNeeded: form.get('partsNeeded') || null,
      signedBy: form.get('signedBy') || null,
      note: form.get('note') || null
    }, who(s));

    // The customer's side of the same fact: their order is delivered, they get
    // the email, and the unit is off the site.
    await markOrderDeliveredForJob(jobId);

    return NextResponse.json({ ok: true, job, photos: photos.length });
  } catch (e) {
    console.error('driver completion failed', e?.message || e);
    return NextResponse.json({ error: e?.message || 'Could not save that.' }, { status: 500 });
  }
}
