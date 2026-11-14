import { redirect } from 'next/navigation';
import { getSession, isAdmin } from '../../../lib/auth';
import { hasDb } from '../../../lib/db';
import { getPartner, getPartnerSeat } from '../../../lib/referral-partners';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Video tutorials — Bargain Bay', robots: { index: false } };

// Narrated walkthroughs of the portal, built from the demo pages (/partner/demo), so every name and figure in them is invented.
// An organisation's managers see both; a lead generator sees theirs. The files are served by /api/partner/tutorial, signed in only.
const Video = ({ v, title, mins, text }) => (
  <div className="panel" style={{ marginBottom: 14 }}>
    <h2 style={{ marginTop: 0, fontSize: 19, color: 'var(--charcoal)' }}>{title} <span className="hint" style={{ fontSize: 13 }}>· {mins}</span></h2>
    <p className="hint" style={{ marginTop: 0 }}>{text}</p>
    <video controls preload="metadata" playsInline style={{ width: '100%', maxWidth: 900, borderRadius: 8, background: '#2e2d2b' }} src={`/api/partner/tutorial?v=${v}`} />
  </div>
);

export default async function TutorialsPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/partner/tutorials');
  const org = hasDb() ? await getPartner(session.email) : null;
  const seat = hasDb() && !org ? await getPartnerSeat(session.email) : null;
  const manager = !!org || isAdmin(session);
  if (!manager && !seat) {
    return (<div className="narrow"><div className="panel"><p>These tutorials are for Bargain Bay partners and their lead generators.</p></div></div>);
  }
  return (
    <div className="narrow">
      <div className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, flex: 1, color: 'var(--charcoal)' }}>Video tutorials</h1>
          <a className="btn" href="/partner">← Back to my portal</a>
        </div>
        <p className="hint" style={{ margin: '8px 0 0' }}>Short narrated walkthroughs. The people and orders in them are examples, not real customers.</p>
      </div>
      {manager && <Video v="managers" title="Your partner portal" mins="about 2½ minutes" text="For managers: your links, your team, the lead board, the posting kit, and your totals." />}
      <Video v="generators" title="Your lead desk" mins="about 1½ minutes" text="For lead generators: your code, sending a lead, reading your board, and the posting kit." />
    </div>
  );
}
