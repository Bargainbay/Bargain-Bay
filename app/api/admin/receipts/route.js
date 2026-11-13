// Receipts: save one (with its photo), link it to a bank line, record that somebody was paid back, void it.
// Books-level: admin or a granted accountant, same as the bankroll.
import { NextResponse } from 'next/server';
import { getSession, canKeepBooks } from '../../../../lib/auth';
import { audit } from '../../../../lib/audit';
import { createReceipt, linkReceiptToBank, markReimbursed, markReimbursedMany, voidReceipt, bankCandidates } from '../../../../lib/receipts';
import { loadBankroll } from '../../../../lib/bankroll-load';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function who() { const s = await getSession(); return s && (await canKeepBooks(s)) ? s : null; }

export async function POST(req) {
  const session = await who();
  if (!session) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  const by = session.email || session.name || null;
  try {
    const ct = req.headers.get('content-type') || '';
    // A new receipt arrives as a form (the photo is a file); everything else is JSON.
    if (ct.includes('multipart/form-data')) {
      const f = await req.formData();
      const photo = f.get('photo');
      const id = await createReceipt({
        date: f.get('date'), vendor: f.get('vendor'), total: f.get('total'), tax: f.get('tax'), category: f.get('category'),
        paidWith: f.get('paidWith'), paidBy: f.get('paidBy'), reimburse: f.get('reimburse') !== 'no', note: f.get('note'),
        photo: photo && typeof photo === 'object' ? photo : null, by
      });
      await audit(session, { action: 'receipt.add', entity: 'receipt', entityId: String(id), summary: `Receipt #${id}: ${f.get('vendor') || ''} $${f.get('total')} (${f.get('paidWith')})` });
      return NextResponse.json({ ok: true, savedId: id, ...(await loadBankroll(f.get('viewDate') || undefined)) });
    }
    const b = await req.json().catch(() => ({}));
    if (b.action === 'candidates') {
      return NextResponse.json({ ok: true, candidates: await bankCandidates(b.id, { afterOnly: !!b.afterOnly, daysAfter: b.afterOnly ? 120 : 10 }) });
    }
    if (b.action === 'link') {
      await linkReceiptToBank(b.id, b.expenseId, by);
      await audit(session, { action: 'receipt.link', entity: 'receipt', entityId: String(b.id), summary: `Receipt #${b.id} linked to bank line ${b.expenseId}` });
    } else if (b.action === 'reimburse') {
      await markReimbursed(b.id, { how: b.how, on: b.on, note: b.note, bankExpenseId: b.bankExpenseId, by });
      await audit(session, { action: 'receipt.reimbursed', entity: 'receipt', entityId: String(b.id), summary: `Receipt #${b.id} paid back (${b.how})` });
    } else if (b.action === 'reimburse_many') {
      const r = await markReimbursedMany(b.ids, { how: b.how, on: b.on, note: b.note, bankExpenseId: b.bankExpenseId, by });
      await audit(session, { action: 'receipt.reimbursed', entity: 'receipt', entityId: (b.ids || []).join(','), summary: `${r.count} receipts paid back, $${r.total.toFixed(2)} (${b.how})` });
    } else if (b.action === 'void') {
      await voidReceipt(b.id, by);
      await audit(session, { action: 'receipt.void', entity: 'receipt', entityId: String(b.id), summary: `Receipt #${b.id} voided` });
    } else {
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await loadBankroll(b.viewDate || undefined)) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'That failed.' }, { status: 400 });
  }
}
