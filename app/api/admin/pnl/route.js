// The P&L as a CSV download, for the accountant who wants it in a spreadsheet.
import { getSession, isAdmin } from '../../../../lib/auth';
import { profitAndLoss, pnlCsv, PNL_PERIODS } from '../../../../lib/pnl';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const s = await getSession();
  if (!(s && isAdmin(s))) return new Response('Not authorized', { status: 403 });
  const sp = new URL(req.url).searchParams;
  const period = PNL_PERIODS.some((p) => p.key === sp.get('period')) ? sp.get('period') : 'month';
  const pnl = await profitAndLoss(period).catch(() => null);
  if (!pnl) return new Response('Could not build the statement.', { status: 500 });
  return new Response(pnlCsv(pnl), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bargain-bay-pnl-${pnl.from}-to-${pnl.to}.csv"`
    }
  });
}
