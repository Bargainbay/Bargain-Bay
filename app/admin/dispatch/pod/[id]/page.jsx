import { redirect } from 'next/navigation';
import { getSession, isStaff } from '../../../../../lib/auth';
import { hasDb, query } from '../../../../../lib/db';
import { BUSINESS_LEGAL } from '../../../../../lib/constants';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Proof of delivery', robots: { index: false } };

// The signed Proof of Delivery, on paper. Same form the crew used to carry as a
// pad — the point of capturing it on the phone was never to keep it in a
// database, it was to be able to hand it to a client arguing about a dent.
//
// Server-rendered from jobs.pod_form so it can be printed or saved as a PDF from
// the browser, and so the signature image is fetched through the admin POD route
// rather than being public.
const TICK = (on) => (on ? '☑' : '☐');

export default async function PodPage({ params }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/dispatch');
  if (!isStaff(session)) return <div style={{ padding: 24 }}>Not authorized.</div>;
  if (!hasDb()) return <div style={{ padding: 24 }}>Database not configured.</div>;

  const { rows } = await query(
    `SELECT j.id, j.job_number, j.customer_name, j.address, j.city, j.postal, j.phone,
            j.job_date, j.completed_at, j.signed_by, j.signature_path, j.pod_form, j.notes,
            o.order_number,
            COALESCE(u.name, u.email) AS driver_name,
            (SELECT COALESCE(json_agg(p.id ORDER BY p.id), '[]'::json) FROM job_photos p WHERE p.job_id = j.id) AS photo_ids
       FROM jobs j
       LEFT JOIN orders  o ON o.id = j.order_id
       LEFT JOIN users   u ON u.id = j.driver_id
      WHERE j.id = $1`,
    [Number(id)]
  );
  const j = rows[0];
  if (!j) return <div style={{ padding: 24 }}>No such job.</div>;

  const f = j.pod_form || {};
  const items = Array.isArray(f.items) ? f.items : [];
  const photos = Array.isArray(j.photo_ids) ? j.photo_ids : [];
  const when = j.completed_at || j.job_date;

  return (
    <div className="pod">
      <style>{`
        @media print { @page { margin: 14mm; } .pod-noprint { display: none !important; } }
        .pod { font-family: var(--font-body, system-ui); color: #111; background: #fff; max-width: 840px; margin: 0 auto; padding: 24px; }
        .pod h1 { font-size: 19px; text-align: center; margin: 0 0 18px; }
        .pod h2 { font-size: 15px; text-align: center; margin: 18px 0 6px; }
        .pod p { font-size: 12.5px; line-height: 1.5; margin: 0 0 10px; }
        .pod .meta { font-size: 13px; margin-bottom: 14px; }
        .pod .ask { text-align: center; font-size: 15px; margin: 10px 0; }
        .pod .ask b { font-size: 17px; }
        .pod table { width: 100%; border-collapse: collapse; margin: 10px 0 16px; font-size: 12.5px; }
        .pod th, .pod td { border: 1px solid #444; padding: 6px 7px; text-align: left; vertical-align: top; }
        .pod th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
        .pod .sign { display: flex; gap: 26px; align-items: flex-end; margin-top: 18px; font-size: 14px; }
        .pod .sigbox { flex: 1 1 auto; }
        .pod .sigline { border-bottom: 1px solid #111; min-height: 64px; display: flex; align-items: flex-end; }
        .pod .sigline img { max-height: 76px; max-width: 100%; }
        .pod .cap { font-size: 11px; color: #555; margin-top: 3px; }
        .pod .shots { display: flex; flex-wrap: wrap; gap: 8px; }
        .pod .shots img { width: 150px; height: 150px; object-fit: cover; border: 1px solid #999; }
      `}</style>

      <div className="pod-noprint" style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <a className="btn" href="/admin/dispatch">← Back to the board</a>
      </div>

      <h1>Proof of Delivery form</h1>

      <div className="meta">
        Customer Name: <b>{j.customer_name || '—'}</b> &nbsp; Order: <b>{j.order_number || j.job_number}</b>
        &nbsp; Date: <b>{when ? new Date(when).toLocaleDateString('en-CA') : '—'}</b>
        <br />
        {[j.address, j.city, j.postal].filter(Boolean).join(', ')}
        {j.driver_name ? <> &nbsp;·&nbsp; Delivered by: <b>{j.driver_name}</b></> : null}
      </div>

      <p>
        At {BUSINESS_LEGAL} we take pride in our delivery services. We would like to ensure that you are
        fully content with our services prior to us leaving your premises. Your satisfaction is very
        important to us and we thank you for your business.
      </p>

      <h2>Merchandise / Property Inspection</h2>
      <p>
        I acknowledge that I have inspected my purchase and the area through which it was delivered. I agree
        that my products and property are free from any visible damage or free from any new damages to the
        products if they were purchased as scratch and dent items. I understand that the delivery provider,
        {' '}{BUSINESS_LEGAL}, and the store whom I purchased the items from will not be held responsible for
        any claims for products or property damages after my inspection has been completed.
      </p>

      <div className="ask">
        Product is damage free: <b>{TICK(f.productDamageFree === 'yes')} Yes</b> &nbsp;&nbsp;
        <b>{TICK(f.productDamageFree === 'no')} No</b>
      </div>
      <div className="ask">
        Property is damage free: <b>{TICK(f.propertyDamageFree === 'yes')} Yes</b> &nbsp;&nbsp;
        <b>{TICK(f.propertyDamageFree === 'no')} No</b>
      </div>

      <p><b>Detailed explanation:</b> {f.explanation || '—'}</p>

      <table>
        <thead>
          <tr>
            <th style={{ width: '44%' }}>Item</th>
            <th>Serial number</th>
            <th style={{ width: 80 }}>Delivered</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {(items.length ? items : [{ description: '', serial: '', delivered: null, notes: '' }]).map((it, i) => (
            <tr key={i}>
              <td>{[it.make, it.model].filter(Boolean).join(' ') || it.description || ' '}</td>
              <td>{it.serial || ' '}</td>
              <td>{it.delivered == null ? ' ' : TICK(it.delivered)}</td>
              <td>{it.notes || ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        {/* The indemnified party is the company that DID the delivery — us — and
            separately "the stores I/We purchased the items from", which covers
            the client whose sale it was. The paper form named a client company
            here; that was a typo carried over from whoever it was drafted for. */}
        <b>Authorized Consent:</b> I/We fully understand that by signing this Proof of Delivery form without
        indicating any product/property damage, We agree to indemnify and hold entirely harmless
        {' '}{BUSINESS_LEGAL}, their employees, contractors, owner operator(s), representatives as well as the
        stores I/We purchased the items from, from any claim or remedial action as it arises from any aspect
        of delivery. I have
        read the above fully and understand that by signing this waiver I am surrendering legal rights to
        which I may be entitled to in the Province of Ontario. I certify that I am the purchaser of the
        merchandise or a duly authorized representative of the purchaser and I am authorized to sign on the
        purchaser&apos;s behalf.
      </p>

      <div className="sign">
        <div className="sigbox">
          <div className="sigline">{f.printName || j.signed_by || ' '}</div>
          <div className="cap">Print name</div>
        </div>
        <div className="sigbox">
          <div className="sigline">
            {j.signature_path
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={`/api/admin/pod?jobsig=${j.id}`} alt="Customer signature" />
              : ' '}
          </div>
          <div className="cap">Signature</div>
        </div>
        <div className="sigbox" style={{ flex: '0 0 150px' }}>
          <div className="sigline">{when ? new Date(when).toLocaleDateString('en-CA') : ' '}</div>
          <div className="cap">Date</div>
        </div>
      </div>

      {photos.length > 0 && (
        <>
          <h2 style={{ textAlign: 'left', marginTop: 22 }}>Photos taken at the door</h2>
          <div className="shots">
            {photos.map((pid) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={pid} src={`/api/admin/pod?jobphoto=${pid}`} alt="Delivery photo" />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
