// Plaid's "there's new data" ping. This is what makes the feed live rather than
// once-a-night: Plaid posts here minutes after a transaction settles.
//
// The payload is NEVER trusted for data — it only triggers a pull that uses our
// own credentials. So the check that matters is simply "is this one of the banks
// we actually linked", which stops an outsider using this as a free way to make
// us hammer Plaid. A signature check (the plaid-verification JWT) would be a
// reasonable hardening on top; it is not what stands between this and bad data.
import { NextResponse } from 'next/server';
import { knownItem, syncPlaidTransactions } from '../../../../lib/plaid';
import { getSetting, setSetting } from '../../../../lib/settings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MIN_GAP_MS = 60 * 1000; // one sync a minute is plenty for a bank feed

export async function POST(req) {
  let b; try { b = await req.json(); } catch { b = {}; }
  // Always 200: Plaid retries and eventually disables a webhook that errors, and
  // there is nothing here a retry would fix.
  const ok = (extra = {}) => NextResponse.json({ ok: true, ...extra });

  if (b.webhook_type !== 'TRANSACTIONS') return ok({ ignored: b.webhook_type || 'unknown' });
  if (!(await knownItem(b.item_id).catch(() => false))) return ok({ ignored: 'unknown item' });

  // SYNC_UPDATES_AVAILABLE is the one that matters for /transactions/sync; the
  // legacy INITIAL/HISTORICAL_UPDATE codes mean the same thing to us.
  const wants = ['SYNC_UPDATES_AVAILABLE', 'INITIAL_UPDATE', 'HISTORICAL_UPDATE', 'DEFAULT_UPDATE', 'TRANSACTIONS_REMOVED'];
  if (!wants.includes(b.webhook_code)) return ok({ ignored: b.webhook_code });

  try {
    const last = Number(await getSetting('plaid_webhook_at', 0).catch(() => 0));
    if (Date.now() - last < MIN_GAP_MS) return ok({ throttled: true });
    await setSetting('plaid_webhook_at', Date.now());
    const r = await syncPlaidTransactions();
    return ok({ synced: r.added + r.updated + r.removed });
  } catch (e) {
    console.error('plaid webhook sync failed', e?.message || e);
    return ok({ error: 'sync failed' });
  }
}
