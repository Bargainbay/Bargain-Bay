// What the Voice Manager can actually FIX, as plain functions the call and the
// admin page both use. Each does one bounded thing, reports what it did AND what
// it refused to do, and writes a line in the stop's own history so "who closed
// that" has an answer.
//
// What is deliberately NOT here: money (collections, refunds, invoices, prices),
// customers, orders' contents, driver assignment. A stop that has money reported
// against it or a balance still owing is left for a person every time.
import { query, hasDb, withTransaction } from './db';
import { staleStops, setJobStatus } from './jobs';

const BY = { email: 'voice-manager@bargainbay.ca', name: 'Voice Manager' };

// A stale stop is "real" when something on file says it happened: a signature,
// photos, or a clock-in. Those are closed as Done (the work was done and nobody
// tapped it). The rest never left a trace, and are cancelled rather than claimed
// as deliveries nobody can show.
export function decideStop(s, mode) {
  if (s.reported > 0) return { act: 'skip', why: 'a driver reported taking money on it' };
  if (s.balanceDue > 0) return { act: 'skip', why: `$${s.balanceDue.toFixed(2)} is still owing on its invoice` };
  if (mode === 'cancel_all') return { act: 'cancel' };
  const happened = s.hasSignature || s.photoCount > 0 || !!s.timeIn;
  return happened ? { act: 'done' } : { act: 'cancel' };
}

// Plan only: what closing would do, without doing it.
export async function planStaleClose(mode = 'auto') {
  const { rows } = await staleStops();
  const plan = rows.map((s) => ({ s, ...decideStop(s, mode) }));
  return {
    total: plan.length,
    done: plan.filter((p) => p.act === 'done').length,
    cancel: plan.filter((p) => p.act === 'cancel').length,
    skipped: plan.filter((p) => p.act === 'skip').map((p) => ({ job: p.s.jobNumber, why: p.why })),
    plan
  };
}

export async function closeStaleStops({ mode = 'auto' } = {}) {
  if (!hasDb()) throw new Error('Database not configured.');
  const { plan } = await planStaleClose(mode);
  const out = { done: 0, cancelled: 0, skipped: [], failed: [] };
  for (const p of plan) {
    const label = p.s.jobNumber || `#${p.s.id}`;
    if (p.act === 'skip') { out.skipped.push({ job: label, why: p.why }); continue; }
    try {
      if (p.act === 'cancel') {
        await setJobStatus(p.s.id, 'cancelled', { note: 'Closed by the Voice Manager at the owner\'s instruction: dated before today and never started or closed.' }, BY);
        out.cancelled++;
      } else {
        // Done WITHOUT stamping a finish time of "now": a stop dated weeks ago would
        // otherwise report weeks on site and poison the pay and profit reports.
        // Whatever clock the stop already carries is left exactly as it was.
        await withTransaction(async (client) => {
          const r = await client.query(
            `UPDATE jobs SET status = 'done', completed_at = COALESCE(completed_at, job_date::timestamptz + interval '12 hours')
              WHERE id = $1 AND status NOT IN ('done','failed','cancelled')`, [p.s.id]);
          if (!r.rowCount) return;
          await client.query(
            'INSERT INTO job_events (job_id, event, detail, by_email, by_name) VALUES ($1,$2,$3,$4,$5)',
            [p.s.id, 'done', 'Closed as done by the Voice Manager at the owner\'s instruction: it carries a signature, photos or a clock-in but nobody tapped Done. No finish time was invented.', BY.email, BY.name]);
        });
        out.done++;
      }
    } catch (e) {
      out.failed.push({ job: label, why: e?.message || String(e) });
    }
  }
  return out;
}

// Run the off-site backup now and say WHY if it fails. The cron route used to
// answer 500 with the reason buried two levels down and no top-level `error`,
// so the heartbeat stored nothing: 625 failures with an empty reason.
export async function backupNow() {
  const { runOffsiteBackup, summariseBackupFailure } = await import('./offsite-backup');
  const r = await runOffsiteBackup();
  return { ok: !!r.ok, dormant: !!r.dormant, reason: r.ok ? null : summariseBackupFailure(r), detail: r };
}

// Is the CDA watcher able to read the workbook, and if not, what is missing?
export async function cdaStatus() {
  const { oneDriveStatus, oneDriveConfigured } = await import('./onedrive');
  const s = await oneDriveStatus();
  const missing = [];
  if (!process.env.MS_CLIENT_ID) missing.push('MS_CLIENT_ID is not set');
  if (!process.env.MS_CLIENT_SECRET) missing.push('MS_CLIENT_SECRET is not set (create a client secret on the Microsoft app and add it in Vercel)');
  if (oneDriveConfigured() && !s.connected) missing.push('nobody has pressed Connect Microsoft on the dispatch page yet');
  if (s.connected && !(s.fileId || s.shareUrl)) missing.push('no workbook has been chosen or its share link pasted');
  let read = null;
  if (!missing.length) {
    const { watchCdaSheet } = await import('./cda-watch');
    const r = await watchCdaSheet({ dryRun: true });
    read = r.ok === false ? `The read failed: ${r.reason || r.error || 'unknown'}` : 'The workbook was read fine.';
  }
  return { configured: oneDriveConfigured(), connected: s.connected, account: s.account, fileName: s.fileName, missing, read };
}

// A change that needs code. The call cannot edit the codebase, so it queues the
// request where the owner and the developer both see it.
export async function queueDevRequest(text) {
  const body = `DEV: ${String(text || '').trim().slice(0, 480)}`;
  await query('INSERT INTO manager_notes (body) VALUES ($1)', [body]);
  return body;
}
