// What is wrong with the business right now — one scan, one list.
//
// The Voice Manager rings the owner about THIS list, and /admin/manager shows it,
// so the phone and the screen cannot disagree about what is wrong.
//
// Every check is independent and READ-ONLY. A check that cannot run does NOT
// vanish: it becomes an issue of its own ("I could not check X"), because the
// failure this whole feature exists to end is the one where a thing stops being
// looked at and nothing says so (the CDA watcher read nothing for months; the
// tracker sync dropped 61 units in silence). A scanner that returned "all clear"
// because half its checks threw would be that failure again, with a phone call.
//
// An issue is { key, area, severity, title, speak, detail, count, link }:
//   key      stable id, used to snooze it and to refer to it on the phone
//   speak    one plain sentence fit to be read aloud
//   detail   the long version, for the email / the page
//   link     where a person fixes it by hand
import { query, hasDb } from './db';
import { evaluateHealth } from './health';
import { modelPhotoRows } from './model-photos';
import { photoGapsNeedingAPerson } from './catalog-sync';
import { SITE_URL } from './site';
import { staleStopCount } from './jobs';
import { sheetsConfigured } from './sheets';
import { getSetting } from './settings';
import { rankIssues, applySnoozes } from './manager-rules';
import { BUSINESS_CHECKS } from './manager-business';

const H = 3600_000;
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

async function timed(label, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`manager scan: ${label} failed`, e?.message || e);
    return [{
      key: `scan-${label}`, area: 'manager', severity: 'medium',
      title: `Could not check ${label}`,
      speak: `I could not run my ${label} check, so I do not know if anything is wrong there`,
      detail: `The ${label} check threw: ${e?.message || e}`, count: 1, link: '/admin/manager'
    }];
  }
}

// ── The checks ──────────────────────────────────────────────────────────────

// Scheduled jobs and configuration — the same evaluation the daily health email
// uses, so the call and the email can never disagree.
async function checkHealth() {
  if (!hasDb()) return [];
  let heartbeats = [];
  try { heartbeats = (await query('SELECT * FROM cron_heartbeats')).rows; } catch { /* not migrated */ }
  const res = evaluateHealth({ heartbeats, env: process.env });
  const out = res.bad.map((t, i) => ({
    key: `health-${t.split(':')[0].split(' ')[0].toLowerCase()}-${i}`, area: 'systems', severity: 'high',
    title: t, speak: t.replace(/_/g, ' '), detail: t, count: 1, link: '/admin/reports'
  }));
  // Warnings are one line, not one issue each — "no run recorded yet" x6 is noise.
  if (res.warn.length) {
    out.push({
      key: 'health-warnings', area: 'systems', severity: 'low',
      title: `${plural(res.warn.length, 'scheduled-job note')}`,
      speak: `${plural(res.warn.length, 'scheduled job has a note', 'scheduled jobs have notes')}`,
      detail: res.warn.join('\n'), count: res.warn.length, link: '/admin/reports'
    });
  }
  return out;
}

// A model the site shows with branded placeholder art. /feed also skips it, so it
// cannot be advertised. Finding the photo is the Manager's own job
// (lib/stock-photo-finder.js, hourly): a model is raised only once it has looked
// and failed, with what it tried.
async function checkPhotos() {
  if (!hasDb()) return [];
  const missing = (await modelPhotoRows()).filter((r) => r.source === 'missing');
  if (!missing.length) return [];
  const why = await photoGapsNeedingAPerson(missing);
  const rows = missing.filter((r) => r.model in why);
  if (!rows.length) return [];
  const units = rows.reduce((n, r) => n + (r.units || 0), 0);
  return [{
    key: 'photos-missing', area: 'catalogue', severity: rows.length >= 5 ? 'high' : 'medium',
    title: `I looked and could not find a stock photo for ${plural(rows.length, 'model')} (${plural(units, 'unit')} on the site)`,
    speak: `I looked and could not find a stock photo for ${plural(rows.length, 'model')}, ${plural(units, 'unit')} in all`,
    detail: rows.map((r) => `${r.model} (${r.make || '?'} ${r.category || ''}, ${plural(r.units, 'unit')})${why[r.model] ? ` ${why[r.model]}` : ''}`).join('\n'),
    count: rows.length, link: '/admin/photos', data: { models: rows.map((r) => ({ model: r.model, make: r.make, category: r.category, units: r.units })) }
  }];
}

// Is the storefront actually up, and does the Meta feed agree with the database?
async function checkSite() {
  const out = [];
  const get = async (path) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    try {
      const r = await fetch(`${SITE_URL}${path}`, { signal: ctl.signal, cache: 'no-store' });
      return { status: r.status, text: r.ok ? await r.text() : '' };
    } catch (e) { return { status: 0, text: '', error: e?.message }; }
    finally { clearTimeout(t); }
  };
  const [shop, feed] = await Promise.all([get('/shop'), get('/feed')]);
  for (const [name, r] of [['/shop', shop], ['/feed', feed]]) {
    if (r.status !== 200) {
      out.push({
        key: `site-${name.slice(1)}-down`, area: 'site', severity: 'high',
        title: `${name} did not load (${r.status || r.error || 'no answer'})`,
        speak: `the ${name.slice(1)} page on the website did not load`,
        detail: `GET ${SITE_URL}${name} answered ${r.status || r.error || 'nothing'}.`, count: 1, link: SITE_URL + name
      });
    }
  }
  if (feed.status === 200 && hasDb()) {
    const rows = (feed.text.match(/\/product\//g) || []).length;
    const { rows: [c] } = await query(`SELECT count(*)::int AS n FROM products WHERE active = true`);
    // The feed legitimately skips placeholder-art units, so only a big gap means
    // something is wrong (an empty feed is how ads quietly stop serving).
    if (c.n >= 10 && rows < c.n * 0.5) {
      out.push({
        key: 'site-feed-short', area: 'site', severity: 'medium',
        title: `The Meta feed lists ${rows} units but the database has ${c.n} for sale`,
        speak: `the ad feed lists only ${rows} of the ${c.n} units for sale`,
        detail: `/feed carries ${rows} product links; products has ${c.n} active rows. Units with no stock photo are skipped; check /admin/photos first.`,
        count: c.n - rows, link: '/admin/photos'
      });
    }
  }
  return out;
}

// The tracker is the source of truth; the site is a copy of it. If the copy is
// old, customers are looking at stale stock.
async function checkSyncFreshness() {
  if (!hasDb()) return [];
  const { rows: [r] } = await query(`SELECT max(synced_at) AS at, count(*) FILTER (WHERE active)::int AS live FROM products`);
  if (!r?.at) return [];
  const age = Date.now() - new Date(r.at).getTime();
  if (age <= 26 * H) return [];
  return [{
    key: 'sync-stale', area: 'catalogue', severity: 'high',
    title: `Inventory last synced from the tracker ${Math.round(age / H)} hours ago`,
    speak: `the website's stock was last refreshed from the tracker ${Math.round(age / H)} hours ago`,
    detail: `products.synced_at is ${new Date(r.at).toISOString()}. ${r.live} units are live. Run Sync inventory on /admin/operations.`,
    count: 1, link: '/admin/operations', fix: 'run_inventory_sync'
  }];
}

// Prices that look wrong on their face: nothing priced at zero, nothing listed
// above its own retail.
async function checkPrices() {
  if (!hasDb()) return [];
  const { rows: [r] } = await query(
    `SELECT count(*) FILTER (WHERE COALESCE(price,0) <= 0)::int AS zero,
            count(*) FILTER (WHERE compare_at > 0 AND price > compare_at)::int AS above
       FROM products WHERE active = true`);
  const out = [];
  if (r.zero) out.push({
    key: 'price-zero', area: 'catalogue', severity: 'high',
    title: `${plural(r.zero, 'unit')} on the site priced at zero or blank`,
    speak: `${plural(r.zero, 'unit')} on the site ${r.zero === 1 ? 'has' : 'have'} no price`,
    detail: 'Active products with price <= 0.', count: r.zero, link: '/admin/operations'
  });
  if (r.above) out.push({
    key: 'price-above-retail', area: 'catalogue', severity: 'medium',
    title: `${plural(r.above, 'unit')} listed above its own retail price`,
    speak: `${plural(r.above, 'unit')} ${r.above === 1 ? 'is' : 'are'} listed above the retail price`,
    detail: 'Active products where price > compare_at. Usually a typed price or a vendor uplift on a blank retail.', count: r.above, link: '/admin/operations'
  });
  return out;
}

// Stock the tracker and RS Ops disagree about, and sales with no unit behind them.
async function checkStockGaps() {
  if (!sheetsConfigured()) return [];
  const { inventoryGapsReport } = await import('./stock-reconcile');
  const g = await inventoryGapsReport({});
  const out = [];
  if (g.unlinked?.length) out.push({
    key: 'gaps-unlinked', area: 'stock', severity: 'high',
    title: `${plural(g.unlinked.length, 'sale line')} with no stock unit behind ${g.unlinked.length === 1 ? 'it' : 'them'}`,
    speak: `${plural(g.unlinked.length, 'recent sale')} ${g.unlinked.length === 1 ? 'was' : 'were'} not tied to a real unit, so stock may be wrong`,
    detail: 'Invoice lines typed by hand that name no SKU. See Stock gaps.', count: g.unlinked.length, link: '/admin/inventory-gaps'
  });
  if (g.waitingCount) out.push({
    key: 'gaps-waiting', area: 'stock', severity: g.waitingCount >= 20 ? 'medium' : 'low',
    title: `${plural(g.waitingCount, 'unit')} on the tracker with no cost`,
    speak: `${plural(g.waitingCount, 'unit')} ${g.waitingCount === 1 ? 'is' : 'are'} on the tracker with no cost yet`,
    detail: 'Rows marked NEEDS INVOICE with no cost. Type the cost on Stock gaps or record the purchase invoice.', count: g.waitingCount, link: '/admin/inventory-gaps'
  });
  if (g.pendingFillCount) out.push({
    key: 'gaps-fills', area: 'stock', severity: 'medium',
    title: `${plural(g.pendingFillCount, 'invoice match')} waiting for your approval`,
    speak: `${plural(g.pendingFillCount, 'invoice match', 'invoice matches')} ${g.pendingFillCount === 1 ? 'is' : 'are'} waiting for you to approve`,
    detail: 'Purchase-invoice lines matched to NEEDS INVOICE rows. Admin approves on Stock gaps.', count: g.pendingFillCount, link: '/admin/inventory-gaps'
  });
  return out;
}

async function checkDispatch() {
  if (!hasDb()) return [];
  const out = [];
  const stale = await staleStopCount();
  if (stale) out.push({
    key: 'dispatch-loose-ends', area: 'dispatch', severity: stale >= 5 ? 'high' : 'medium',
    title: `${plural(stale, 'delivery stop')} from earlier days never closed`,
    speak: `${plural(stale, 'delivery stop')} from earlier days ${stale === 1 ? 'was' : 'were'} never closed out`,
    detail: 'Jobs dated before today that are not done, failed or cancelled. See Loose ends on the dispatch board.', count: stale, link: '/admin/dispatch'
  });
  try {
    const { rows: [m] } = await query(`SELECT count(*)::int AS n, COALESCE(sum(amount),0)::float AS total FROM job_collections WHERE status = 'pending'`);
    if (m.n) out.push({
      key: 'dispatch-money', area: 'money', severity: 'high',
      title: `${plural(m.n, 'cash collection')} reported by drivers, $${m.total.toFixed(2)}, waiting for you to confirm`,
      speak: `drivers reported ${plural(m.n, 'cash collection')}, ${Math.round(m.total)} dollars, that nobody has confirmed`,
      detail: 'Door money is a claim until an admin confirms it; the invoice stays unpaid until then.', count: m.n, link: '/admin/dispatch'
    });
  } catch { /* table not there yet */ }
  return out;
}

async function checkApplications() {
  if (!hasDb()) return [];
  const out = [];
  const { rows: [m] } = await query(`SELECT count(*)::int AS n FROM users WHERE member_status = 'pending'`);
  if (m.n) out.push({
    key: 'apps-resellers', area: 'sales', severity: 'medium',
    title: `${plural(m.n, 'reseller application')} waiting for review`,
    speak: `${plural(m.n, 'reseller application')} ${m.n === 1 ? 'is' : 'are'} waiting for your review`,
    detail: 'Approve or reject on /admin/resellers.', count: m.n, link: '/admin/resellers'
  });
  return out;
}

// The owner's own to-dos, dictated on a previous call.
async function checkNotes() {
  if (!hasDb()) return [];
  try {
    const { rows } = await query(`SELECT id, body FROM manager_notes WHERE done_at IS NULL ORDER BY id`);
    if (!rows.length) return [];
    return [{
      key: 'notes-open', area: 'manager', severity: 'low',
      title: `${plural(rows.length, 'open note')} you left me`,
      speak: `you have ${plural(rows.length, 'open note')} you asked me to keep`,
      detail: rows.map((r) => `- ${r.body}`).join('\n'), count: rows.length, link: '/admin/manager'
    }];
  } catch { return []; }
}

// The Manager's phone numbers live in the environment, not the source (the repository is public).
// Unset is SAFE (it refuses every caller and rings nobody) but it also means the phone does nothing,
// so in production it is loud rather than quiet.
async function checkPhoneConfig() {
  const { isProduction } = await import('./environment');
  if (!isProduction()) return [];
  const { callers } = await import('./manager-policy');
  const { managerTarget } = await import('./manager-call');
  const missing = [];
  if (!callers().length) missing.push('MANAGER_CALLERS (who may ring in)');
  if (!(await managerTarget())) missing.push('MANAGER_CALL_TO (the number it rings)');
  if (!missing.length) return [];
  return [{
    key: 'manager-phone-config', area: 'manager', severity: 'high',
    title: `The Manager's phone numbers are not set: ${missing.join(', ')}`,
    speak: 'My phone numbers are not set in Vercel, so I cannot ring you and I will refuse every inbound call',
    detail: `Set in Vercel (Production): ${missing.join('; ')}. Format for MANAGER_CALLERS: Owner:4165550100,Ravi:4165550101. The numbers were removed from the public source on 2026-11-20.`,
    count: missing.length, link: '/admin/manager'
  }];
}

// The morning review (lib/exec.js), read from what it stored — the scan never
// rebuilds it. Only what no other check raises: the bottleneck, finished stock
// nobody can buy, people to talk to, and client work done but never invoiced.
async function checkReview() {
  const s = await getSetting('exec_snapshot', null);
  if (!s?.at) return [];
  const old = Date.now() - Date.parse(s.at);
  if (old > 30 * H) return [{
    key: 'review-old', area: 'manager', severity: 'high', title: `My business review is ${Math.round(old / H)} hours old`,
    speak: 'my morning review of the business has not run since yesterday', detail: 'The exec-brief job is not completing. Open the Manager page and press Review now to see why.', count: 1, link: '/admin/manager'
  }];
  const out = [];
  const c = s.flow?.constraint;
  if (c && c.count >= 3) out.push({
    key: 'floor-bottleneck', area: 'floor', severity: c.stalled ? 'high' : 'medium',
    title: `Bottleneck: ${plural(c.count, 'unit')} ${c.label.toLowerCase()}${c.stalled ? ', none finished in two weeks' : ''}`,
    speak: `the bottleneck is ${c.who}: ${plural(c.count, 'unit')} ${c.label.toLowerCase()}`,
    detail: `Oldest ${c.oldestDays} days. ${c.sample?.join(', ') || ''}`, count: c.count, link: '/admin/manager'
  });
  const hidden = s.flow?.readyNotOnSite || [];
  if (hidden.length) out.push({
    key: 'floor-unlisted', area: 'floor', severity: hidden.length >= 5 ? 'high' : 'medium',
    title: `${plural(hidden.length, 'finished unit')} not for sale on the website`,
    speak: `${plural(hidden.length, 'finished unit')} ${hidden.length === 1 ? 'is' : 'are'} not for sale on the website`,
    detail: hidden.slice(0, 20).map((u) => `${u.id} ${u.model}${u.days != null ? `, ${u.days} days` : ''}`).join('\n'), count: hidden.length, link: '/admin/manager'
  });
  const talk = (s.people || []).filter((p) => p.flags?.length);
  if (talk.length) out.push({
    key: 'people-followup', area: 'people', severity: 'medium',
    title: `${plural(talk.length, 'person', 'people')} to follow up with: ${talk.map((p) => p.name.split(' ')[0]).join(', ')}`,
    speak: `there ${talk.length === 1 ? 'is one person' : `are ${talk.length} people`} I would follow up with`,
    detail: talk.map((p) => `${p.name}: ${p.flags.map((f) => f.text).join('; ')}`).join('\n'), count: talk.length, link: '/admin/manager'
  });
  const u = s.money?.unbilled;
  if (u?.count) out.push({
    key: 'money-unbilled', area: 'money', severity: u.billedThrough && u.total >= 500 ? 'high' : 'medium',
    title: `$${Math.round(u.total).toLocaleString('en-CA')} of client delivery work with no invoice in the system`,
    speak: `${Math.round(u.total)} dollars of client delivery work has no invoice in the system, so I want it checked`,
    detail: `${plural(u.count, 'stop')}: ${(u.clients || []).join(', ')}. ${u.billedThrough ? `Counted from after ${u.billedThrough}.` : 'Some may be billed from your own sheets: set the date you have billed up to on the Manager page.'}`, count: u.count, link: '/admin/manager'
  });
  return out;
}

// ── The scan ────────────────────────────────────────────────────────────────

export const CHECKS = [
  ['systems', checkHealth], ['photos', checkPhotos], ['website', checkSite],
  ['inventory sync', checkSyncFreshness], ['prices', checkPrices], ['stock gaps', checkStockGaps],
  ['dispatch', checkDispatch], ['applications', checkApplications], ['notes', checkNotes], ['phone config', checkPhoneConfig], ['the business review', checkReview],
  // The business half: sales, receivables, deliveries, follow-ups, supplier bills.
  ...BUSINESS_CHECKS
];

export async function loadSnoozes() {
  const v = await getSetting('manager_snoozes', {});
  return v && typeof v === 'object' ? v : {};
}

// → { issues (live, ranked), hidden (snoozed), scannedAt }
export async function scanIssues() {
  const results = await Promise.all(CHECKS.map(([label, fn]) => timed(label, fn)));
  const all = rankIssues(results.flat());
  const { live, hidden } = applySnoozes(all, await loadSnoozes());
  return { issues: live, hidden, scannedAt: new Date().toISOString() };
}
