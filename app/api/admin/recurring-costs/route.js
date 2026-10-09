// The cost list behind the daily P&L. ADMIN only.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { query } from '../../../../lib/db';
import { COST_FREQUENCIES } from '../../../../lib/daily-cost-math';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');

export async function POST(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  let b; try { b = await req.json(); } catch { b = {}; }
  try {
    if (b.action === 'remove') {
      // Switched off, not deleted: past days must keep the figure they had.
      await query('UPDATE recurring_costs SET active = false, ends_on = COALESCE(ends_on, CURRENT_DATE) WHERE id = $1', [Number(b.id)]);
      return NextResponse.json({ ok: true });
    }
    const name = String(b.name || '').trim().slice(0, 120);
    const amount = Number(b.amount);
    if (!name) throw new Error('Give the cost a name, like "Rent" or "Hydro".');
    if (!Number.isFinite(amount) || amount < 0) throw new Error('Amount must be a number, before tax.');
    if (!COST_FREQUENCIES.some((f) => f.key === b.frequency)) throw new Error('Pick how often it is billed.');
    if (!isDate(b.startsOn)) throw new Error('Pick the date it started (or the date, for a one-time cost).');
    const vals = [name, String(b.category || 'Other').slice(0, 60), Math.round(amount * 100) / 100,
      b.frequency, b.startsOn, isDate(b.endsOn) ? b.endsOn : null, String(b.note || '').slice(0, 300) || null];
    if (b.id) {
      await query(`UPDATE recurring_costs SET name=$1, category=$2, amount=$3, frequency=$4, starts_on=$5, ends_on=$6, note=$7, active=true WHERE id=$8`, [...vals, Number(b.id)]);
    } else {
      await query(`INSERT INTO recurring_costs (name, category, amount, frequency, starts_on, ends_on, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [...vals, s.email]);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not save.' }, { status: 400 });
  }
}
