// Pulls every Meta Instant Form lead into the right board, on a schedule (the Manager runs this).
//
// Needs META_LEADS_ACCESS_TOKEN (or the ad-spend token META_ADS_ACCESS_TOKEN, if it carries the
// leads_retrieval permission and the pages are assigned to it). With no token the pass reports
// "not configured" and the Manager raises it as an issue: silence is the failure this exists to end.
//
// Rules that must hold:
//   · A lead is remembered (meta_leads_seen) only AFTER it has landed on its board. A failed delivery
//     is retried next pass. Both destinations are also idempotent on email/phone, so a repeat is harmless.
//   · It only READS Meta and only WRITES our own boards. It emails nobody who filled a form.
//   · A lead we cannot reach (no email, no 10-digit phone) is remembered and skipped, not retried for ever.
import { hasDb, query } from './db';
import { createLead } from './leads';
import { getSetting, setSetting } from './settings';
import { sendEmail } from './email';
import { SERVICE_EMAIL } from './constants';
import { SITE_URL } from './site';
import { parsePages, leadFromMeta, destinationFor, reachable } from './meta-leads-rules';

const GRAPH = 'https://graph.facebook.com/v21.0';
const SYSTEM = { admin: true, email: 'meta-leads@system', name: 'Meta lead pull' };
const rsBase = () => (process.env.RSSOLUTIONS_SITE_URL || 'https://rssolutions.ca').replace(/\/+$/, '');
export const STATUS_KEY = 'meta_leads_status';
export const token = () => process.env.META_LEADS_ACCESS_TOKEN || process.env.META_ADS_ACCESS_TOKEN || '';

async function graph(path, params, f = fetch) {
  const url = `${GRAPH}${path}?${new URLSearchParams(params)}`;
  const res = await f(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`Meta said: ${body.error?.message || res.status}`);
  return body;
}

async function* leadsOf(formId, since, tok, f) {
  let next = null; let pages = 0;
  const first = { fields: 'id,created_time,field_data,campaign_name,ad_name', limit: '100', access_token: tok,
    filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(since / 1000) }]) };
  let body = await graph(`/${formId}/leads`, first, f);
  for (;;) {
    for (const l of body.data || []) yield l;
    next = body.paging?.next; pages++;
    if (!next || pages >= 10) return;
    const res = await f(next, { signal: AbortSignal.timeout(20000) });
    body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) throw new Error(`Meta said: ${body.error?.message || res.status}`);
  }
}

async function toWorkshopBoard(lead) {
  const key = process.env.META_LEADS_KEY;
  if (!key) throw new Error('META_LEADS_KEY is not set, so RS Solutions workshop leads cannot be delivered.');
  const res = await fetch(`${rsBase()}/api/ops/meta-leads`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-meta-leads-key': key },
    body: JSON.stringify({ leads: [{ name: lead.name, email: lead.email, phone: lead.phone, createdAt: lead.createdAt, metaId: lead.metaId, formName: lead.formName }] }),
    signal: AbortSignal.timeout(30000)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(`The RS Solutions Board refused the lead (${res.status}${j.error ? `: ${j.error}` : ''}).`);
  return j.added > 0 ? 'added' : 'already';
}

async function toHub(lead, side) {
  try {
    await createLead({
      side, contactName: lead.name || null, email: lead.email || null, phone: lead.phone || null,
      source: 'social', utmSource: 'meta', utmCampaign: (lead.campaign || lead.formName || '').slice(0, 100), sourceDetail: lead.formName.slice(0, 100)
    }, SYSTEM);
    return 'added';
  } catch (e) {
    if (e?.code === 'duplicate') return 'already';
    throw e;
  }
}

/** One pass. `fetchImpl` is for tests. Returns a summary and records it for the Manager. */
export async function runMetaLeadPull({ dry = false, fetchImpl = fetch, now = Date.now() } = {}) {
  const tok = token();
  const pages = parsePages(process.env.META_LEAD_PAGES);
  const out = { ok: true, configured: !!tok, at: new Date(now).toISOString(), pages: pages.length, seen: 0, added: { workshop: 0, 'hub-rs': 0, 'hub-bb': 0 }, already: 0, unreachable: 0, errors: [] };
  if (!tok) { out.ok = true; out.error = 'No Meta token set (META_LEADS_ACCESS_TOKEN), so no leads are being pulled.'; if (!dry && hasDb()) await setSetting(STATUS_KEY, out); return out; }
  if (!hasDb()) return { ...out, ok: false, error: 'Database not configured.' };
  const prev = await getSetting(STATUS_KEY, null);
  const since = prev?.lastOkAt ? Date.parse(prev.lastOkAt) - 24 * 3600_000 : now - 21 * 86400_000;

  for (const page of pages) {
    try {
      let ptok = tok;
      try { const p = await graph(`/${page.id}`, { fields: 'access_token', access_token: tok }, fetchImpl); if (p.access_token) ptok = p.access_token; } catch { /* a system-user token reads forms directly */ }
      const forms = (await graph(`/${page.id}/leadgen_forms`, { fields: 'id,name,status', limit: '100', access_token: ptok }, fetchImpl)).data || [];
      for (const form of forms) {
        for await (const raw of leadsOf(form.id, since, ptok, fetchImpl)) {
          out.seen++;
          const lead = leadFromMeta(raw, form.name);
          const done = await query('SELECT 1 FROM meta_leads_seen WHERE leadgen_id = $1', [lead.metaId]);
          if (done.rows.length) { out.already++; continue; }
          const where = destinationFor(page.side, form.name);
          if (!reachable(lead)) { out.unreachable++; if (!dry) await remember(lead, page, form, 'unreachable'); continue; }
          if (dry) { out.added[where]++; continue; }
          try {
            const r = where === 'workshop' ? await toWorkshopBoard(lead) : await toHub(lead, where === 'hub-bb' ? 'bb' : 'rs');
            await remember(lead, page, form, where);
            if (r === 'added') out.added[where]++; else out.already++;
          } catch (e) { out.errors.push(`${lead.name || lead.metaId}: ${e.message}`); }
        }
      }
    } catch (e) { out.errors.push(`Page ${page.id}: ${e.message}`); }
  }
  out.ok = out.errors.length === 0;
  if (out.errors.length) out.error = out.errors.slice(0, 3).join(' | ');
  if (!dry) {
    await setSetting(STATUS_KEY, { ...out, lastOkAt: out.ok ? out.at : prev?.lastOkAt || null });
    const n = out.added.workshop + out.added['hub-rs'] + out.added['hub-bb'];
    if (n) await notify(out).catch((e) => console.error('meta-leads notify failed', e?.message || e));
    if (n) await logPull(out).catch((e) => console.error('meta-leads action log failed', e?.message || e));
  }
  return out;
}

async function remember(lead, page, form, routedTo) {
  await query(
    `INSERT INTO meta_leads_seen (leadgen_id, page_id, form_id, form_name, routed_to, created_time)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (leadgen_id) DO NOTHING`,
    [lead.metaId, page.id, form.id, form.name || null, routedTo, lead.createdAt]);
}

// The Manager owns this chore: every pull that brings leads in is written to its action log, so it shows
// under "What the Manager did" and is read back on the next call (lib/manager-actions.js).
async function logPull(out) {
  const a = out.added; const parts = [];
  if (a.workshop) parts.push(`${a.workshop} on the workshop Board`);
  if (a['hub-rs']) parts.push(`${a['hub-rs']} on the RS Solutions lead board`);
  if (a['hub-bb']) parts.push(`${a['hub-bb']} on the Bargain Bay lead board`);
  const n = a.workshop + a['hub-rs'] + a['hub-bb'];
  const { logAction } = await import('./manager-actions');
  await logAction({ kind: 'pull_meta_leads', summary: `pulled ${n} new Facebook lead${n === 1 ? '' : 's'} onto the boards (${parts.join(', ')})`, detail: { added: a } });
}

async function notify(out) {
  const a = out.added; const lines = [];
  if (a.workshop) lines.push(`${a.workshop} new workshop lead${a.workshop === 1 ? '' : 's'} on the RS Solutions Board: https://rssolutions.ca/admin (Workshop, then Board)`);
  if (a['hub-rs']) lines.push(`${a['hub-rs']} new RS Solutions lead${a['hub-rs'] === 1 ? '' : 's'} on the lead board: ${SITE_URL}/sales/leads`);
  if (a['hub-bb']) lines.push(`${a['hub-bb']} new Bargain Bay lead${a['hub-bb'] === 1 ? '' : 's'} on the lead board: ${SITE_URL}/sales/leads`);
  await sendEmail({ to: SERVICE_EMAIL, subject: `New Meta leads: ${a.workshop + a['hub-rs'] + a['hub-bb']}`, html: `<p>${lines.join('<br>')}</p><p>Call them while they are still interested.</p>` });
}

/** For the Manager: leads that came in from Meta and nobody has touched. */
export async function staleMetaLeads({ hours = 4 } = {}) {
  if (!hasDb()) return { hubBb: 0, hubRs: 0, oldestHours: 0 };
  const { rows } = await query(
    `SELECT side, count(*)::int AS n, coalesce(max(extract(epoch FROM (now() - created_at)) / 3600), 0)::float AS oldest
       FROM leads
      WHERE created_by = $1 AND stage = 'new' AND first_touch_at IS NULL AND created_at < now() - ($2 || ' hours')::interval
      GROUP BY side`, [SYSTEM.email, String(hours)]);
  const by = Object.fromEntries(rows.map((r) => [r.side, r]));
  return { hubBb: by.bb?.n || 0, hubRs: by.rs?.n || 0, oldestHours: Math.round(Math.max(...rows.map((r) => r.oldest), 0)) };
}

/** The workshop Board's waiting count, from rs-solutions. Throws if it cannot be asked. */
export async function workshopWaiting() {
  const key = process.env.META_LEADS_KEY;
  if (!key) return null;
  const res = await fetch(`${rsBase()}/api/ops/meta-leads?hours=4`, { headers: { 'x-meta-leads-key': key }, signal: AbortSignal.timeout(20000), cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(`The RS Solutions Board did not answer (${res.status}).`);
  return j;
}
