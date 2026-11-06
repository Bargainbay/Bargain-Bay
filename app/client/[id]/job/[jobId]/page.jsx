import Link from 'next/link';
import { hasDb } from '../../../../../lib/db';
import { brandFor } from '../../../../../lib/brands';
import { HST_NUMBER, torontoTime, torontoDate, formatPhone } from '../../../../../lib/constants';
import { linkToken } from '../../../../../lib/links';
import { getClientForPortal, getClientJob, verifyClientToken, fmtMinutes } from '../../../../../lib/client-portal';
import ClientPortalStyle from '../../../../../components/ClientPortalStyle';
import PrintButton from '../../../../../components/PrintButton';
import { portalAccess } from '../../../../../lib/client-portal-session';
import ClientPortalLogin from '../../../../../components/ClientPortalLogin';
import { DEMO_CLIENT, DEMO_JOBS, demoImage } from '../../../../../lib/client-portal-demo';

export const dynamic = 'force-dynamic';
export const metadata = { title: { absolute: 'Delivery details — RS Solutions' }, robots: { index: false, follow: false }, referrer: 'no-referrer' };

const TICK = (on) => (on ? '☑' : '☐');
const stamp = (v) => (v ? `${torontoDate(v)} ${torontoTime(v)}` : null);

export default async function ClientJob({ params, searchParams }) {
  const { id, jobId } = await params;
  const sp = await searchParams;
  const B = brandFor('rs_solutions');
  const demo = id === 'demo';
  if (!demo && (!hasDb() || !verifyClientToken(id, sp?.t))) {
    return <div className="cp narrow"><ClientPortalStyle /><div className="cp-panel"><h1>This link isn&apos;t valid</h1><p>Ask {B.contactEmail} for a fresh one.</p></div></div>;
  }
  const gate = demo ? 'ok' : await portalAccess(id, sp?.t);
  if (gate !== 'ok') {
    // Same wall as the list: the link names the client, the password lets you in.
    return <div className="cp narrow"><ClientPortalStyle />{gate === 'no_password'
      ? <div className="cp-panel"><h1>Almost ready</h1><p>Portal access has not been switched on yet. Please contact {B.contactEmail}.</p></div>
      : <ClientPortalLogin clientId={id} token={sp.t} />}</div>;
  }
  const [client, j] = demo
    ? [DEMO_CLIENT, DEMO_JOBS.find((x) => String(x.id) === String(jobId)) || null]
    : await Promise.all([getClientForPortal(id), getClientJob(id, jobId)]);
  if (!client || !j) return <div className="cp"><ClientPortalStyle /><div className="cp-panel">We couldn&apos;t find that stop.</div></div>;

  const t = encodeURIComponent(sp?.t || 'demo');
  const img = (kind, val, extra = '') => (demo ? demoImage(kind, val) : `/api/client/pod?c=${id}&t=${t}&${kind}=${val}${extra}`);
  const f = j.podForm || {};
  const podItems = Array.isArray(f.items) ? f.items : [];
  const label = `${j.orderNumber || j.jobNumber}-${(j.customerName || '').split(' ')[0] || 'stop'}`;
  const closed = ['done', 'failed'].includes(j.status);

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

      {demo && <div className="notice-box cp-noprint"><b>Preview with sample data.</b> Nothing here is a real customer.</div>}
      <Link className="cp-back cp-noprint" href={`/client/${id}?t=${t}`}>← All deliveries for {client.name}</Link>

      <h1>{j.customerName || 'Delivery'}</h1>
      <div className="cp-sub">{j.typeLabel} · {j.jobNumber}{j.orderNumber ? ` · Order ${j.orderNumber}` : ''} · {client.name}</div>

      <div className="cp-panel" style={{ marginTop: 14 }}>
        <div className="cp-grid">
          <div><div className="cp-k">Status</div><div className="cp-v">{j.statusLabel}{j.failReason ? ` — ${j.failReason}` : ''}</div></div>
          <div><div className="cp-k">Date</div><div className="cp-v">{j.date ? torontoDate(`${j.date}T12:00:00`) : '—'}{j.windowStart ? ` · window ${j.windowStart}${j.windowEnd ? `–${j.windowEnd}` : ''}` : ''}</div></div>
          <div><div className="cp-k">Delivered to</div><div className="cp-v">{j.address || '—'}</div></div>
          {j.pickup && <div><div className="cp-k">Collected from</div><div className="cp-v">{j.pickup}</div></div>}
          {j.phone && <div><div className="cp-k">Customer phone</div><div className="cp-v">{formatPhone(j.phone)}</div></div>}
          <div><div className="cp-k">Crew</div><div className="cp-v">{[j.driverName, j.driver2Name].filter(Boolean).join(' + ') || '—'}</div></div>
          {j.shipmentType && <div><div className="cp-k">Service level</div><div className="cp-v">{j.shipmentType === 'white_glove' ? 'White glove' : 'Threshold'}</div></div>}
          {j.services.length > 0 && <div><div className="cp-k">Services</div><div className="cp-v">{j.services.join(', ')}</div></div>}
        </div>
        {j.notes && <p className="cp-addr" style={{ marginTop: 12 }}><b>Notes:</b> {j.notes}</p>}
      </div>

      <div className="cp-panel">
        <h2>Time on site</h2>
        <div className="cp-time">
          <div className={`cp-step ${j.leftAt ? 'on' : ''}`}><span className="cp-k">Left for the stop</span><b>{torontoTime(j.leftAt) || '—'}</b></div>
          <div className={`cp-step ${j.timeIn ? 'on' : ''}`}><span className="cp-k">Arrived</span><b>{torontoTime(j.timeIn || j.arrivedAt) || '—'}</b></div>
          <div className={`cp-step ${j.timeOut ? 'on' : ''}`}><span className="cp-k">{j.status === 'failed' ? 'Left (not completed)' : 'Finished'}</span><b>{torontoTime(j.timeOut || j.completedAt) || '—'}</b></div>
          <div className={`cp-step ${j.minutesOnSite != null ? 'on' : ''}`}><span className="cp-k">Time on site</span><b>{fmtMinutes(j.minutesOnSite) || '—'}</b></div>
        </div>
        {!closed && <p className="cp-sub" style={{ margin: '8px 0 0' }}>Times appear as the crew reaches each step.</p>}
      </div>

      {j.items.length > 0 && (
        <div className="cp-panel">
          <h2>Items</h2>
          <div className="cp-scroll"><table>
            <thead><tr><th>Item</th><th>SKU / Model</th><th style={{ width: 70 }}>Qty</th>{closed && <th style={{ width: 90 }}>Delivered</th>}</tr></thead>
            <tbody>
              {j.items.map((it, i) => (
                <tr key={i}><td>{it.description}</td><td>{it.sku || '—'}</td><td>{it.qty}</td>
                  {closed && <td>{it.delivered == null ? '—' : it.delivered ? '✓ Yes' : '✗ Not delivered'}</td>}</tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <div className="cp-panel">
        <h2>Proof of delivery</h2>
        {!j.hasPod ? (
          <p className="cp-sub" style={{ margin: 0 }}>{closed ? 'No signed form was captured for this stop.' : 'The signed proof of delivery appears here as soon as the crew finishes the stop.'}</p>
        ) : (
          <>
            <div className="cp-grid">
              <div><div className="cp-k">Product damage free</div><div className="cp-v">{f.productDamageFree ? `${TICK(f.productDamageFree === 'yes')} Yes   ${TICK(f.productDamageFree === 'no')} No` : '—'}</div></div>
              <div><div className="cp-k">Property damage free</div><div className="cp-v">{f.propertyDamageFree ? `${TICK(f.propertyDamageFree === 'yes')} Yes   ${TICK(f.propertyDamageFree === 'no')} No` : '—'}</div></div>
              <div><div className="cp-k">Signed by</div><div className="cp-v">{f.printName || j.signedBy || '—'}</div></div>
              <div><div className="cp-k">Signed at</div><div className="cp-v">{stamp(j.completedAt) || '—'}</div></div>
            </div>
            {f.explanation && <p style={{ marginTop: 12 }}><b>Customer / driver explanation:</b> {f.explanation}</p>}
            {podItems.length > 0 && (
              <div className="cp-scroll"><table style={{ marginTop: 10 }}>
                <thead><tr><th>Item</th><th>Serial number</th><th style={{ width: 90 }}>Delivered</th><th>Notes</th></tr></thead>
                <tbody>
                  {podItems.map((it, i) => (
                    <tr key={i}>
                      <td>{[it.make, it.model].filter(Boolean).join(' ') || it.description || ' '}</td>
                      <td>{it.serial || ' '}</td>
                      <td>{it.delivered == null ? ' ' : TICK(it.delivered)}</td>
                      <td>{it.notes || ' '}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            {j.hasSignature && (
              <div style={{ marginTop: 14 }}>
                <div className="cp-k" style={{ marginBottom: 4 }}>Customer signature</div>
                <div className="cp-sig">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img('sig', j.id)} alt="Customer signature" />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="cp-panel">
        <h2>Photos from the door{j.photoIds.length ? ` (${j.photoIds.length})` : ''}</h2>
        {j.photoIds.length === 0 ? (
          <p className="cp-sub" style={{ margin: 0 }}>No photos were taken at this stop{closed ? '' : ' yet'}.</p>
        ) : (
          <>
            <div className="cp-shots">
              {j.photoIds.map((pid, n) => (
                <a key={pid} href={img('photo', pid)} target="_blank" rel="noreferrer" title="Open full size">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img('photo', pid)} alt={`Delivery photo ${n + 1}`} loading="lazy" />
                </a>
              ))}
            </div>
            <p className="cp-noprint cp-sub" style={{ marginBottom: 0 }}>
              Tap a photo to open it full size. Save one:{' '}
              {j.photoIds.map((pid, n) => (
                <a key={pid} href={img('photo', pid, `&download=1&name=${encodeURIComponent(`${label}-${n + 1}`)}`)} style={{ marginRight: 8 }}>#{n + 1}</a>
              ))}
            </p>
          </>
        )}
      </div>

      {j.invoiceNumber && !demo && (
        <div className="cp-panel cp-noprint">
          <h2>Billing</h2>
          <a href={`/invoice/${encodeURIComponent(j.invoiceNumber)}?t=${linkToken('invoice', j.invoiceNumber)}`}>View invoice {j.invoiceNumber} →</a>
        </div>
      )}
    </div>
  );
}
