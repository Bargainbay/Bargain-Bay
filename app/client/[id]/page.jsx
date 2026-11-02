import Link from 'next/link';
import { hasDb } from '../../../lib/db';
import { brandFor } from '../../../lib/brands';
import { HST_NUMBER, torontoTime, torontoDate } from '../../../lib/constants';
import { JOB_STATUSES } from '../../../lib/jobs';
import { getClientForPortal, listClientJobs, verifyClientToken, summarize, fmtMinutes } from '../../../lib/client-portal';
import ClientPortalStyle from '../../../components/ClientPortalStyle';
import PrintButton from '../../../components/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your deliveries', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const pillClass = (s) => (s === 'done' ? 'done' : s === 'failed' ? 'failed' : s === 'cancelled' ? 'cancelled'
  : ['on_the_way', 'arrived'].includes(s) ? 'live' : 'todo');

export default async function ClientPortal({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const B = brandFor('rs_solutions');

  if (!hasDb() || !verifyClientToken(id, sp?.t)) {
    return (
      <div className="cp narrow">
        <ClientPortalStyle />
        <div className="cp-panel">
          <h1>This link isn&apos;t valid</h1>
          <p>Open the delivery link you were sent, or ask {B.name} dispatch for a fresh one: {B.contactEmail}.</p>
        </div>
      </div>
    );
  }
  const client = await getClientForPortal(id);
  if (!client) return <div className="cp"><ClientPortalStyle /><div className="cp-panel">This account is not active.</div></div>;

  const filters = {
    from: sp?.from || '', to: sp?.to || '', status: sp?.status || '', q: sp?.q || ''
  };
  const jobs = await listClientJobs(id, filters);
  const sum = summarize(jobs);
  const t = encodeURIComponent(sp.t);
  const filtered = !!(filters.from || filters.to || filters.status || filters.q);

  return (
    <div className="cp">
      <ClientPortalStyle />
      <div className="cp-head">
        <div>
          <div className="cp-brand">{B.name}</div>
          <div className="cp-sub">{B.legal} · {B.address}</div>
          <div className="cp-sub">{B.contactEmail} · GST/HST# {HST_NUMBER}</div>
        </div>
        <div className="cp-noprint"><PrintButton label="Print / Save as PDF" /></div>
      </div>

      <h1>{client.name}</h1>
      <div className="cp-sub">
        {client.contact_name ? `Welcome, ${client.contact_name}. ` : ''}Every delivery we run for you, with the time on site, signed proof of delivery and the photos taken at the door.
      </div>

      <div className="cp-tiles">
        <div className="cp-tile"><b>{sum.total}</b><span>{filtered ? 'Matching stops' : 'Total stops'}</span></div>
        <div className="cp-tile"><b>{sum.delivered}</b><span>Completed</span></div>
        <div className="cp-tile"><b>{sum.upcoming}</b><span>Coming up</span></div>
        <div className="cp-tile"><b>{sum.failed}</b><span>Couldn&apos;t complete</span></div>
        <div className="cp-tile"><b>{sum.withPod}</b><span>With signed POD</span></div>
        <div className="cp-tile"><b>{fmtMinutes(sum.avgMinutes) || '—'}</b><span>Avg. time on site</span></div>
      </div>

      <form method="GET" className="cp-filter cp-noprint">
        <input type="hidden" name="t" value={sp.t} />
        <div><label htmlFor="f-q">Search</label><input id="f-q" type="search" name="q" defaultValue={filters.q} placeholder="Name, address, item, stop #" /></div>
        <div><label htmlFor="f-from">From</label><input id="f-from" type="date" name="from" defaultValue={filters.from} /></div>
        <div><label htmlFor="f-to">To</label><input id="f-to" type="date" name="to" defaultValue={filters.to} /></div>
        <div>
          <label htmlFor="f-st">Status</label>
          <select id="f-st" name="status" defaultValue={filters.status}>
            <option value="">All</option>
            {Object.entries(JOB_STATUSES).filter(([k]) => k !== 'unscheduled').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <button className="btn primary">Filter</button>
        {filtered && <Link className="btn" href={`/client/${id}?t=${t}`}>Clear</Link>}
      </form>

      {jobs.length === 0 && <div className="cp-empty">No stops {filtered ? 'match those filters' : 'yet'}.</div>}

      {jobs.map((j) => (
        <Link key={j.id} className="cp-card" href={`/client/${id}/job/${j.id}?t=${t}`}>
          <div className="cp-row">
            <div>
              <div className="cp-name">{j.customerName || 'Customer'}</div>
              <div className="cp-addr">{j.address || '—'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className={`cp-pill ${pillClass(j.status)}`}>{j.statusLabel}</span>
              <div className="cp-sub" style={{ marginTop: 4 }}>{j.date ? torontoDate(`${j.date}T12:00:00`) : 'No date'} · {j.jobNumber}</div>
            </div>
          </div>
          {j.items.length > 0 && (
            <div className="cp-addr" style={{ marginTop: 6 }}>{j.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.description}`).join(' · ')}</div>
          )}
          <div className="cp-meta">
            <span>{j.typeLabel}{j.services.length ? ` · ${j.services.join(', ')}` : ''}</span>
            {j.status === 'done' && (
              <>
                <span>On site <b>{torontoTime(j.timeIn) || '—'}–{torontoTime(j.timeOut) || '—'}</b>{j.minutesOnSite != null ? ` (${fmtMinutes(j.minutesOnSite)})` : ''}</span>
                <span>POD <b>{j.hasSignature ? 'signed ✓' : j.hasPod ? 'recorded' : '—'}</b></span>
                <span>Photos <b>{j.photoIds.length}</b></span>
              </>
            )}
            {j.status === 'failed' && j.failReason && <span>Reason <b>{j.failReason}</b></span>}
          </div>
        </Link>
      ))}
    </div>
  );
}
