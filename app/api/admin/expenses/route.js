// Operating expenses CRUD (one-off + recurring templates). Admin-only.
import { NextResponse } from 'next/server';
import { getSession, canKeepBooks } from '../../../../lib/auth';
import { listExpenses, addExpense, updateExpense, deleteExpense, bulkSetExpenseTax,
         listRecurringExpenses, addRecurringExpense, deleteRecurringExpense } from '../../../../lib/finance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Admins and granted accountants: categorising an expense and answering its
// HST is exactly what an accountant is here to do.
async function admin() { return canKeepBooks(await getSession()); }

export async function GET() {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const [expenses, recurring] = await Promise.all([listExpenses(), listRecurringExpenses()]);
  return NextResponse.json({ expenses, recurring });
}

export async function POST(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    // Recurring template (rent/storage/subscription): auto-posts each cycle.
    if (b.recurring) {
      if (!(Number(b.amount) > 0)) return NextResponse.json({ error: 'Amount is required.' }, { status: 400 });
      const id = await addRecurringExpense({ category: b.category, vendor: b.vendor, amount: b.amount, cadence: b.cadence, dayOf: b.dayOf, note: b.note });
      return NextResponse.json({ ok: true, id });
    }
    if (!b.incurredOn || !(Number(b.amount) > 0)) return NextResponse.json({ error: 'Date and amount are required.' }, { status: 400 });
    const id = await addExpense({ incurredOn: b.incurredOn, category: b.category, vendor: b.vendor, amount: b.amount, note: b.note, tax: b.tax });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 500 });
  }
}

// Correct a row, or fill in the HST on one entered before the tax column
// existed. Only the keys actually sent are touched.
export async function PATCH(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  // Settle the HST on a batch at once — the only way a bank feed of several
  // thousand charges ever gets reviewed.
  if (b.action === 'bulk_tax') {
    const ids = Array.isArray(b.ids) ? b.ids : [];
    if (!ids.length) return NextResponse.json({ error: 'Pick at least one row.' }, { status: 400 });
    try {
      const r = await bulkSetExpenseTax(ids, b.mode === 'hst' ? 'hst' : 'none');
      return NextResponse.json({ ok: true, ...r });
    } catch (e) {
      return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 500 });
    }
  }

  const id = Number(b.id);
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  if (Object.prototype.hasOwnProperty.call(b, 'amount') && !(Number(b.amount) > 0)) {
    return NextResponse.json({ error: 'Amount must be more than zero.' }, { status: 400 });
  }
  const patch = {};
  for (const k of ['incurredOn', 'category', 'vendor', 'amount', 'note', 'tax']) {
    if (Object.prototype.hasOwnProperty.call(b, k)) patch[k] = b[k];
  }
  try {
    const changed = await updateExpense(id, patch);
    if (!changed) return NextResponse.json({ error: 'That expense no longer exists.' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 500 });
  }
}

export async function DELETE(req) {
  if (!(await admin())) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  const recurring = url.searchParams.get('recurring') === '1';
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  try {
    if (recurring) await deleteRecurringExpense(id);
    else await deleteExpense(id);
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e?.message || 'Could not delete.' }, { status: 500 }); }
}
