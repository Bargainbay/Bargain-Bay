import { NextResponse } from 'next/server';
import { cronAuthorized } from '../../../../lib/cron-auth';
import { withHeartbeat } from '../../../../lib/heartbeat';
import { plaidConfigured, plaidStatus, refreshFromBank, syncPlaidTransactions, liveBalances } from '../../../../lib/plaid';
import { nameTransfersFromEmail } from '../../../../lib/interac-names';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

// Every 30 minutes through the working day: ask the bank for fresh transactions, take them, read the live balance,
// and name the new e-transfers from Interac's emails. Plaid bills the refresh and the live balance per call, so
// it stays inside business hours (Toronto) rather than running all night.
const FROM_HOUR = 8, TO_HOUR = 21;
const torontoHour = () => Number(new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto', hour: '2-digit', hour12: false }));

async function run(req) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  if (!plaidConfigured()) return NextResponse.json({ ok: true, skipped: 'Plaid is not configured.' });
  const url = new URL(req.url);
  const h = torontoHour();
  if (url.searchParams.get('force') !== '1' && (h < FROM_HOUR || h >= TO_HOUR)) {
    return NextResponse.json({ ok: true, skipped: `Outside ${FROM_HOUR}:00-${TO_HOUR}:00 Toronto time.` });
  }
  try {
    const st = await plaidStatus();
    if (!st.connected) return NextResponse.json({ ok: true, skipped: 'No bank connected.' });
    const notes = await refreshFromBank();
    const sync = await syncPlaidTransactions();
    const bal = await liveBalances();
    const names = await nameTransfersFromEmail().catch((e) => ({ ok: false, reason: e?.message }));
    const failed = (sync.errors || []).length || (bal.errors || []).length;
    // A balance that could not be read is a failure to look into, not a quiet success.
    return NextResponse.json({ ok: !failed, notes, sync, balanceAt: bal.at, balanceErrors: bal.errors, named: names.named?.length || 0 }, { status: failed ? 500 : 200 });
  } catch (e) {
    console.error('bank-refresh cron failed', e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || 'failed' }, { status: 500 });
  }
}

const beat = withHeartbeat('bank-refresh', run);
export const GET = beat;
export const POST = beat;
