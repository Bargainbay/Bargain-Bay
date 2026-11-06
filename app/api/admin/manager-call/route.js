// The Manager page's data and its buttons. ADMIN only: the agent can change the
// catalogue and refresh stock by voice, and the number it rings is the owner's.
import { NextResponse } from 'next/server';
import { getSession, isAdmin } from '../../../../lib/auth';
import { scanIssues, loadSnoozes } from '../../../../lib/manager-issues';
import {
  startManagerCall, recentCalls, openNotes, ensureManagerSchema, callConfigured, managerTarget
} from '../../../../lib/manager-call';
import { planStaleClose, closeStaleStops, backupNow, cdaStatus } from '../../../../lib/manager-fixes';
import { setSetting } from '../../../../lib/settings';
import { query } from '../../../../lib/db';
import { audit } from '../../../../lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

async function admin() { const s = await getSession(); return s && isAdmin(s) ? s : null; }
const denied = () => NextResponse.json({ error: 'Not authorized' }, { status: 403 });

export async function GET() {
  if (!(await admin())) return denied();
  try {
    const [scan, calls, notes, snoozes, to] = await Promise.all([scanIssues(), recentCalls(10), openNotes(), loadSnoozes(), managerTarget()]);
    const last4 = (to || '').slice(-4);
    return NextResponse.json({ ...scan, calls, notes, snoozes, configured: callConfigured(), ringsLast4: last4 });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not scan.' }, { status: 500 });
  }
}

export async function POST(req) {
  const s = await admin();
  if (!s) return denied();
  let body = {};
  try { body = await req.json(); } catch { /* empty */ }
  try {
    switch (body.action) {
      case 'call': {
        const r = await startManagerCall({ trigger: 'manual' });
        await audit(s, { action: 'manager.call', entity: 'manager_call', entityId: String(r.callId || ''), summary: r.ok ? 'Rang the owner now' : `Call not placed: ${r.reason}` });
        return NextResponse.json(r, { status: r.ok ? 200 : 409 });
      }
      case 'snooze': {
        const days = Math.min(30, Math.max(1, Number(body.days) || 3));
        const snoozes = await loadSnoozes();
        snoozes[String(body.key)] = new Date(Date.now() + days * 86400_000).toISOString();
        await setSetting('manager_snoozes', snoozes);
        return NextResponse.json({ ok: true });
      }
      case 'unsnooze': {
        const snoozes = await loadSnoozes();
        delete snoozes[String(body.key)];
        await setSetting('manager_snoozes', snoozes);
        return NextResponse.json({ ok: true });
      }
      case 'add_note': {
        await ensureManagerSchema();
        const text = String(body.text || '').trim().slice(0, 500);
        if (!text) return NextResponse.json({ error: 'Empty note.' }, { status: 400 });
        await query('INSERT INTO manager_notes (body) VALUES ($1)', [text]);
        return NextResponse.json({ ok: true });
      }
      case 'note_done': {
        await ensureManagerSchema();
        await query('UPDATE manager_notes SET done_at = now() WHERE id = $1', [Number(body.id)]);
        return NextResponse.json({ ok: true });
      }
      // Fix buttons: the same functions the phone call runs. Pressing one IS the
      // owner's yes, so there is no second confirmation here.
      case 'plan_stale': {
        const p = await planStaleClose(body.mode === 'cancel_all' ? 'cancel_all' : 'auto');
        return NextResponse.json({ total: p.total, done: p.done, cancel: p.cancel, skipped: p.skipped });
      }
      case 'close_stale': {
        const r = await closeStaleStops({ mode: body.mode === 'cancel_all' ? 'cancel_all' : 'auto' });
        await audit(s, { action: 'manager.close_stale', entity: 'jobs', summary: `Closed old stops: ${r.done} done, ${r.cancelled} cancelled, ${r.skipped.length} left alone`, detail: r });
        return NextResponse.json({ ok: true, ...r });
      }
      case 'backup_now': {
        const r = await backupNow();
        return NextResponse.json({ ok: r.ok, reason: r.reason, dormant: r.dormant });
      }
      case 'cda_status':
        return NextResponse.json(await cdaStatus());
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Failed.' }, { status: 500 });
  }
}
