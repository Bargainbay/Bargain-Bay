import { hubPage, NotAuthorized } from '../../../../lib/sales-page';
import { hasDb } from '../../../../lib/db';
import { copyFor } from '../../../../lib/rep-agreements';
import { COMPANY_NAME, COMPANY_SIGNATORY } from '../../../../lib/employment-terms';
import SalesNav from '../../../../components/SalesNav';
import PrintButton from '../../../../components/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signed copy — employment agreements' };

const when = (t) => new Date(t).toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'long', timeStyle: 'short' });

// The signed copy, built from the stored text of what the rep actually signed. Print it or Save as PDF.
export default async function CopyPage() {
  const g = await hubPage('/sales/agreement/copy');
  if (g.denied) return <NotAuthorized email={g.email} />;
  const { viewer, side } = g;
  const c = hasDb() ? await copyFor(viewer.email) : null;
  return (
    <div className="doc-print" style={{ maxWidth: 780, margin: '0 auto' }}>
      <div className="noprint">
        <SalesNav side={side} name={viewer.name} admin={viewer.admin} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {c && <PrintButton />}
          {c && <a className="btn" href="/api/sales/agreement?download=1">Download a copy</a>}
          <a className="btn" href="/sales/agreement">Back</a>
        </div>
      </div>
      {!c ? <div className="panel">You have not signed yet. <a href="/sales/agreement">Go to the agreement</a>.</div> : (
        <div>
          <h1 style={{ fontSize: 22 }}>Signed copy: employment agreements</h1>
          {c.docs.map((d) => (
            <section key={d.key} style={{ margin: '18px 0' }}>
              <h2 style={{ fontSize: 17 }}>{d.title}</h2>
              <pre style={{ whiteSpace: 'pre-wrap', font: '14px/1.5 Georgia, serif', margin: 0 }}>{d.text}</pre>
            </section>
          ))}
          <section style={{ marginTop: 24, borderTop: '1px solid #999', paddingTop: 12, breakInside: 'avoid' }}>
            <p style={{ margin: '0 0 4px' }}><b>Signed by the Employee:</b></p>
            <p style={{ margin: 0, fontSize: 26, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>{c.signedName}</p>
            <p style={{ margin: '2px 0 14px', fontSize: 13 }}>{c.address} · {when(c.signedAt)} (Toronto time), electronically</p>
            <p style={{ margin: '0 0 4px' }}><b>For {COMPANY_NAME}</b> ({COMPANY_SIGNATORY}):</p>
            {c.countersigned
              ? <><p style={{ margin: 0, fontSize: 26, fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>{c.countersigned.name}</p><p style={{ margin: '2px 0 0', fontSize: 13 }}>{when(c.countersigned.at)} (Toronto time), electronically</p></>
              : <p style={{ margin: 0, fontSize: 14 }}>Awaiting the company&apos;s countersignature.</p>}
            <p style={{ marginTop: 14, fontSize: 11.5, color: '#666' }}>Version {c.version}. Fingerprints (sha256): {c.docs.map((d) => d.hash.slice(0, 16)).join(', ')}.</p>
          </section>
        </div>
      )}
    </div>
  );
}
