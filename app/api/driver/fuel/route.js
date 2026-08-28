import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getSession } from '../../../../lib/auth';
import { hasDb, query } from '../../../../lib/db';
import { isDriver } from '../../../../lib/drivers';
import { ensureShiftSchema, openShift } from '../../../../lib/shifts';
import { ensureExpenseSchema } from '../../../../lib/dispatch-money';
import { round2 } from '../../../../lib/constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// A fill-up on the road: what it cost, how many litres, what the odometer read,
// and a photo of the receipt.
//
// It lands in `dispatch_expenses` — the SAME table the office types gas into —
// so the Profit tab picks it up with no second code path and no reconciling of
// two sets of fuel figures. Multipart because it carries the receipt.
export async function POST(req) {
  const s = await getSession();
  if (!s || !hasDb() || !(await isDriver(s))) {
    return NextResponse.json({ error: 'Not a driver account.' }, { status: 403 });
  }
  let form;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 }); }

  const ref = String(form.get('ref') || '').slice(0, 80);
  const amount = Number(form.get('amount'));
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'How much was it?' }, { status: 400 });
  }
  await ensureExpenseSchema();
  await ensureShiftSchema();

  // The offline queue replays. A second copy of the same fill would double the
  // day's fuel and quietly halve the mileage figure built on it.
  if (ref) {
    const { rows } = await query('SELECT id FROM dispatch_expenses WHERE ref = $1 LIMIT 1', [ref]);
    if (rows.length) return NextResponse.json({ ok: true, duplicate: true });
  }

  const num = (k) => {
    const n = Number(form.get(k));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(form.get('date') || ''))
    ? String(form.get('date'))
    : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });

  // The van comes from the open shift when the driver didn't pick one — they
  // already told us this morning, and asking twice is how the field ends up
  // blank and the mileage unusable.
  const shift = await openShift(s.userId);
  const vehicleId = Number(form.get('vehicleId')) || shift?.vehicleId || null;

  let receipt = { url: null, pathname: null };
  const photo = form.get('receipt');
  if (photo && typeof photo === 'object' && photo.size > 0) {
    try {
      const r = await put(`fuel/${date}/receipt.jpg`, photo, {
        access: 'private', addRandomSuffix: true, contentType: photo.type || 'image/jpeg'
      });
      receipt = { url: r.url, pathname: r.pathname };
    } catch (e) {
      // The receipt is evidence, the amount is the record. Losing the picture
      // must not lose the fifty dollars.
      console.error('fuel receipt upload failed', e?.message || e);
    }
  }

  const { rows } = await query(
    `INSERT INTO dispatch_expenses
       (expense_date, kind, amount, driver_id, note, created_by, created_by_name,
        litres, odometer_km, vehicle_id, shift_id, receipt_path, receipt_url, ref)
     VALUES ($1,'gas',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id, expense_date, amount, litres, odometer_km`,
    [date, round2(amount), s.userId, String(form.get('note') || '').trim().slice(0, 300) || null,
     s.email || null, s.name || null,
     num('litres'), num('odometer') ? Math.round(num('odometer')) : null,
     vehicleId, shift?.id || null, receipt.pathname, receipt.url, ref || null]
  );
  return NextResponse.json({ ok: true, fuel: rows[0], receiptSaved: !!receipt.pathname });
}
