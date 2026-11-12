import Link from 'next/link';
import { hasDb } from '../../../lib/db';
import { brandFor } from '../../../lib/brands';
import { HST_NUMBER, torontoTime, torontoDate } from '../../../lib/constants';
import { JOB_STATUSES } from '../../../lib/jobs';
import { getClientForPortal, listClientJobs, verifyClientToken, summarize, fmtMinutes } from '../../../lib/client-portal';
import ClientPortalStyle from '../../../components/ClientPortalStyle';
import PrintButton from '../../../components/PrintButton';
import ClientRequestForm from '../../../components/ClientRequestForm';
import { DEMO_CLIENT, DEMO_JOBS, DEMO_INVOICES } from '../../../lib/client-portal-demo';
import { portalAccess } from '../../../lib/client-portal-session';
import ClientPortalLogin from '../../../components/ClientPortalLogin';
import SignOutButton from '../../../components/ClientPortalSignOut';
import { listClientInvoices } from '../../../lib/client-portal';
import { buildSchedule, windowText } from '../../../lib/client-schedule';
import { linkToken } from '../../../lib/links';
import { money } from '../../../lib/constants';

export const dynamic = 'force-dynamic';
export const metadata = { title: { absolute: 'Your deliveries — RS Solutions' }, robots: { index: false, follow: false }, referrer: 'no-referrer' };

const pillClass = (s) => (s === 'done' ? 'done' : s === 'failed' ? 'failed' : s === 'cancelled' ? 'cancelled'
  : ['on_the_way', 'arrived'].includes(s) ? 'live' : 'todo');

export default async function ClientPortal({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;
  const B = brandFor('rs_solutions');

  const demo = id === 'demo';
  if (!demo && (!hasDb() || !verifyClientToken(id, sp?.t))) {
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
  const client = demo ? DEMO_CLIENT : await getClientForPortal(id);
  // The link only says WHICH client. The password says who may look.
  const gate = demo ? 'ok' : await portalAccess(id, sp?.t);
  if (gate === 'no_password') {
    return <div className="cp narrow"><ClientPortalStyle /><div className="cp-panel"><h1>Almost ready</h1><p>Portal access for {client?.name || 'your company'} hasn&apos;t been switched on yet. Please contact {B.name} dispatch at {B.contactEmail}.</p></div></div>;
  }
  if (gate !== 'ok') {
    return <div className="cp narrow"><ClientPortalStyle /><ClientPortalLogin clientId={id} token={sp.t} clientName={client?.name} /></div>;
  }
  if (!client) return <div className="cp"><ClientPortalStyle /><div className="cp-panel">This account is not active.</div></div>;

  const filters = {
    from: sp?.from || '', to: sp?.to || '', status: sp?.status || '', q: sp?.q || ''
  };
  const all = demo
    ? DEMO_JOBS.filter((j) => (!filters.status || j.status === filters.status)
        && (!filters.q || JSON.stringify(j).toLowerCase().includes(filters.q.toLowerCase())))
    : await listClientJobs(id, filters);
  // What is still ahead (requested, scheduled, on the road) first and soonest
  // first; finished work after it, newest first.
  const isOpen = (j) => !['done', 'failed', 'cancelled'].includes(j.status);
  const ahead = all.filter(isOpen).sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
  const past = all.filter((j) => !isOpen(j));
  const jobs = all;
  const invoices = demo ? DEMO_INVOICES : await listClientInvoices(id);
  const owing = invoices.reduce((a, i) => a + i.owing, 0);
  const schedule = buildSchedule(ahead);
  const sum = summarize(jobs);
  const t = encodeURIComponent(sp?.t || 'demo');
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
        <div className="cp-noprint" style={{ display: 'flex', gap: 8 }}>
          <PrintButton label="Print / Save as PDF" />
          {!demo && <SignOutButton clientId={id} token={sp.t} />}
        </div>
      </div>

      {demo && (
        <div className="notice-box cp-noprint">
          <b>Preview with sample data.</b> This is exactly what {client.name} will see on their own link — names and photos here are made up.
        </div>
      )}
      <h1>{client.name}</h1>
      <div className="cp-sub">
        {client.contact_name ? `Welcome, ${client.contact_name}. ` : ''}Every delivery we run for you, with the time on site, signed proof of delivery and the photos taken at the door.
      </div>

      <div className="cp-tiles">
        <div className="cp-tile"><b style={{ color: owing > 0 ? '#b02a37' : undefined }}>{money(owing)}</b><span>Balance owing</span></div>
        <div className="cp-tile"><b>{sum.total}</b><span>{filtered ? 'Matching stops' : 'Total stops'}</span></div>
        <div className="cp-tile"><b>{sum.delivered}</b><span>Completed</span></div>
        <div className="cp-tile"><b>{sum.upcoming}</b><span>Coming up</span></div>
        <div className="cp-tile"><b>{sum.failed}</b><span>Couldn&apos;t complete</span></div>
        <div className="cp-tile"><b>{sum.withPod}</b><span>With signed POD</span></div>
        <div className="cp-tile"><b>{fmtMinutes(sum.avgMinutes) || '—'}</b><span>Avg. time on site</span></div>
      </div>

      {schedule.length > 0 && (
        <section className="cp-panel" id="schedule">
          <h2>Delivery schedule &amp; routes</h2>
          <p className="cp-sub" style={{ marginTop: 0 }}>Scheduled arrival windows and the order each truck will run them. Times may shift on the day; we will tell you if they do.</p>
          {schedule.map((d) => (
            <div key={d.date} style={{ marginTop: 14 }}>
              <h3 style={{ margin: '0 0 6px' }}>{torontoDate(`${d.date}T12:00:00`)}</h3>
              {d.routes.map((r) => (
                <div key={r.key} style={{ marginBottom: 12 }}>
                  <div className="cp-sub" style={{ marginBottom: 4 }}>
                    <b>{r.label}</b>{r.driverName ? ` · ${r.driverName}${r.driver2Name ? ` + ${r.driver2Name}` : ''}` : ''} · {r.stops.length} stop{r.stops.length === 1 ? '' : 's'}
                    {r.mapsUrl && <> · <a href={r.mapsUrl} target="_blank" rel="noreferrer" className="cp-noprint">Open route in Google Maps</a></>}
                  </div>
                  <table className="cp-stack">
                    <thead><tr><th>Stop</th><th>Arrival window</th><th>Customer</th><th>Address</th><th>Items</th></tr></thead>
                    <tbody>
                      {r.stops.map((j, n) => (
                        <tr key={j.id}>
                          <td data-label="Stop"><b>{r.assigned ? n + 1 : '—'}</b></td>
                          <td data-label="Arrival window"><b>{windowText(j)}</b></td>
                          <td data-label="Customer"><Link href={`/client/${id}/job/${j.id}?t=${t}`}>{j.customerName || 'Customer'}</Link></td>
                          <td data-label="Address">{j.address || '—'}</td>
                          <td data-label="Items">{j.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.description}`).join(' · ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      <section className="cp-panel" id="invoices">
        <h2>Invoices</h2>
        {invoices.length === 0 ? (
          <p className="cp-sub" style={{ margin: 0 }}>No invoices yet. They appear here as soon as we raise one.</p>
        ) : (
          <table className="cp-stack">
            <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th>Stops</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Owing</th><th>Status</th><th>PDF</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td data-label="Invoice">{demo ? <b>{i.number}</b> : <a href={`/invoice/${encodeURIComponent(i.number)}?t=${linkToken('invoice', i.number)}`}><b>{i.number}</b></a>}</td>
                  <td data-label="Date">{i.date}</td><td data-label="Due">{i.owing > 0 ? i.due || '—' : '—'}</td><td data-label="Stops">{i.stops}</td>
                  <td data-label="Total" style={{ textAlign: 'right' }}>{money(i.total)}</td>
                  <td data-label="Owing" style={{ textAlign: 'right', fontWeight: 700, color: i.owing > 0 ? '#b02a37' : undefined }}>{i.owing > 0 ? money(i.owing) : '—'}</td>
                  <td data-label="Status"><span className={`cp-pill ${i.status === 'paid' ? 'done' : i.overdue ? 'failed' : 'todo'}`}>{i.status === 'paid' ? 'Paid' : i.status === 'partial' ? 'Part paid' : i.status === 'refunded' ? 'Refunded' : i.overdue ? 'Overdue' : 'Open'}</span></td>
                  <td data-label="PDF">{demo ? <span style={{ color: '#888' }}>PDF</span> : <a href={`/invoice/${encodeURIComponent(i.number)}/pdf?t=${linkToken('invoice', i.number)}`} download>Download PDF</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ClientRequestForm clientId={id} token={sp?.t || ''} demo={demo} />

      <form method="GET" className="cp-filter cp-noprint">
        <input type="hidden" name="t" value={sp?.t || ''} />
        <div><label htmlFor="f-q">Search</label><input id="f-q" type="search" name="q" defaultValue={filters.q} placeholder="Name, address, item, stop #" /></div>
        <div><label htmlFor="f-from">From</label><input id="f-from" type="date" name="from" defaultValue={filters.from} /></div>
        <div><label htmlFor="f-to">To</label><input id="f-to" type="date" name="to" defaultValue={filters.to} /></div>
        <div>
          <label htmlFor="f-st">Status</label>
          <select id="f-st" name="status" defaultValue={filters.status}>
            <option value="">All</option>
            {Object.entries({ ...JOB_STATUSES, unscheduled: 'Requested' }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <button className="btn primary">Filter</button>
        {filtered && <Link className="btn" href={`/client/${id}?t=${t}`}>Clear</Link>}
      </form>

      {jobs.length === 0 && <div className="cp-empty">No stops {filtered ? 'match those filters' : 'yet'}.</div>}
      {[['Coming up & requested', ahead], ['Completed', past]].map(([title, list]) => list.length > 0 && (
        <section key={title}>
          <h2 className="cp-h2">{title} <span className="cp-sub">({list.length})</span></h2>
        {list.map((j) => (
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
            <span>{[...new Set([j.typeLabel, ...j.services])].join(' · ')}</span>
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
        </section>
      ))}
    </div>
  );
}
