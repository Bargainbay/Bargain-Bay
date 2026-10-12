// Preview (GET, read-only) and apply (POST) the correction for sold units saved
// at $0 cost. ADMIN only: it exposes cost and rewrites financial records.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { audit } from '../../../../lib/audit';
import { zeroCostLines, applyZeroCostFix } from '../../../../lib/cost-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const deny = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  const s = await getSession();
  if (!(s && isAdmin(s))) return deny();
  try { return NextResponse.json(await zeroCostLines()); }
  catch (e) { return NextResponse.json({ error: e?.message || 'Could not read.' }, { status: 500 }); }
}

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return deny();
  let b; try { b = await req.json(); } catch { b = {}; }
  // Must say so explicitly: a stray POST can never rewrite anything.
  if (b.confirm !== true) return NextResponse.json({ error: 'Confirmation required.' }, { status: 400 });
  try {
    const r = await applyZeroCostFix({ invoiceLineIds: b.invoiceLineIds, orderLineIds: b.orderLineIds });
    // The ids are in the audit trail: it is the record of exactly what was changed.
    await audit(s, { action: 'cost.zero_fix', entity: 'invoice_items', entityId: null,
      summary: `Reset ${r.invoiceLines} invoice lines and ${r.orderLines} order lines from $0 cost to the tracker cost`,
      detail: { invoiceLineIds: r.invoiceLineIds, orderLineIds: r.orderLineIds, skipped: r.skipped } }).catch(() => {});
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not apply.' }, { status: 400 });
  }
}
