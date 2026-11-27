import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession, isAdmin } from '../../../../lib/auth';
import AdminNav from '../../../../components/AdminNav';
import { hasDb } from '../../../../lib/db';
import { buildMorningBrief } from '../../../../lib/manager-brief';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Manager morning brief — Bargain Bay' };

const money = (n) => (n == null ? '—' : `$${Math.round(Number(n)).toLocaleString('en-CA')}`);
const when = (t) => {
  try { return new Date(t).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
};

// What the Manager did, what it is stuck on, and where sales are leaking. ADMIN only (margin figures).
export default async function BriefPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin/manager/brief');
  if (!isAdmin(session)) {
    return (<div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not authorized</h1>
      <p style={{ fontSize: 14 }}>The Manager&apos;s brief is for the owner.</p>
    </div></div>);
  }
  if (!hasDb()) return (<div><AdminNav active="manager" /><div className="panel">Database not configured.</div></div>);

  const b = await buildMorningBrief();
  const g = b.growth;
  const s = b.snapshot;
  return (
    <div>
      <AdminNav active="manager" />
      <div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Manager&apos;s morning brief</h1>
        <p style={{ fontSize: 13 }}>
          Read-only. Nothing here emails a customer or moves money. <Link href="/admin/manager">Back to the Manager</Link> · Built {when(b.generatedAt)}
        </p>
        {s && (
          <p style={{ fontSize: 14 }}>
            Today: <b>{s.sales?.orders ?? '—'}</b> orders, <b>{money(s.sales?.revenuePreTax)}</b> pre-tax · stops <b>{s.deliveries?.done ?? '—'}/{s.deliveries?.stops ?? '—'}</b> done
            {s.deliveries?.unassigned ? <>, <b style={{ color: '#b00020' }}>{s.deliveries.unassigned} with no driver</b></> : null}
            {' '}· overdue invoices <b>{s.receivables?.overdueInvoices ?? '—'}</b> ({money(s.receivables?.overdueTotal)}) · live stock <b>{s.stockLive ?? '—'}</b>
          </p>
        )}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Needs you</h2>
        {b.needsYou.length ? (
          <ul>{b.needsYou.map((i) => (<li key={i.key}><b>{i.title}</b>{i.link ? <> — <Link href={i.link}>open</Link></> : null}</li>))}</ul>
        ) : <p>Nothing urgent. The Manager has no high-priority issue open.</p>}
        {b.snoozed ? <p style={{ fontSize: 12 }}>{b.snoozed} snoozed issue{b.snoozed === 1 ? '' : 's'} hidden.</p> : null}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>What the Manager did in the last 24 hours</h2>
        {b.done.length ? (
          <ul>{b.done.map((a) => (<li key={a.id}>{a.summary} <span style={{ fontSize: 12 }}>({when(a.at)}, {a.via})</span></li>))}</ul>
        ) : <p>Nothing logged. If that is wrong, check <Link href="/admin/manager">the Manager page</Link> and the health email.</p>}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Who to ring next</h2>
        <p style={{ fontSize: 13 }}>
          {g.sales.counts?.leads ?? 0} open Bargain Bay leads, {g.sales.counts?.carts ?? 0} carts with something still for sale,
          {' '}<b>{g.sales.waiting ?? 0}</b> leads waiting over a day with nobody calling. Ranked by heat, value and how long they have waited.
        </p>
        {g.sales.items.length ? (
          <div className="table-wrap"><table className="admin"><thead><tr><th>Who</th><th>Wants</th><th>Value</th><th>Why now</th><th>Score</th></tr></thead><tbody>
            {g.sales.items.map((i) => (
              <tr key={`${i.kind}-${i.id}`}>
                <td><b>{i.who}</b><br /><span style={{ fontSize: 11 }}>{i.kind === 'cart' ? 'abandoned cart' : (i.source || 'lead')}{i.owner ? ` · ${i.owner}` : ' · unowned'}</span></td>
                <td>{i.what || '—'}</td><td>{i.value ? money(i.value) : '—'}</td><td style={{ fontSize: 12 }}>{i.why}</td><td>{i.score}</td>
              </tr>))}
          </tbody></table></div>
        ) : <p>No open leads or abandoned carts.</p>}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>What people wanted and we did not have (30 days)</h2>
        {g.demand.total ? (
          <div className="table-wrap"><table className="admin"><thead><tr><th>Wanted</th><th>Asked</th><th>In stock now</th><th>Examples</th></tr></thead><tbody>
            {g.demand.byCategory.map((c) => (
              <tr key={c.key}><td><b>{c.label}</b></td><td>{c.asked}</td><td>{c.inStockNow == null ? '—' : c.inStockNow}</td><td style={{ fontSize: 12 }}>{c.examples.join(' · ') || '—'}</td></tr>))}
          </tbody></table></div>
        ) : <p>No leads marked lost for no stock. If leads are arriving, they are not being marked, and nothing can be bought against demand. See the <Link href="/admin/lead-log">lead log</Link>.</p>}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Weak listings</h2>
        <p style={{ fontSize: 13 }}>{g.listings.flagged} of {g.listings.checked} live units have at least one problem. Fix them on the tracker row; the sync overwrites edits made on the site.</p>
        {g.listings.byProblem.length ? (
          <ul>{g.listings.byProblem.map((p) => (<li key={p.key}><b>{p.label}</b>: {p.count} — e.g. {p.examples.join(', ')}</li>))}</ul>
        ) : <p>No problems found.</p>}
        {g.listings.noStockPhoto?.length ? <p style={{ fontSize: 13 }}>Models still without a stock photo: {g.listings.noStockPhoto.map((m) => `${m.model} (${m.units})`).join(', ')}.</p> : null}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Pricing watch (advice only)</h2>
        {!g.pricing.trackerRead && <p style={{ fontSize: 13, color: '#b00020' }}>Could not read the tracker, so the 90-day stale check is missing.</p>}
        {g.pricing.stale.length ? (<>
          <h3>Sitting 90+ days with a healthy margin</h3>
          <ul>{g.pricing.stale.map((h) => (<li key={h.sku}><b>{h.sku}</b>: {h.age} days at {money(h.price)}, margin {money(h.margin)} — try {money(h.suggest)}</li>))}</ul>
        </>) : null}
        {g.pricing.thin.length ? (<>
          <h3>Priced at or near cost</h3>
          <ul>{g.pricing.thin.map((u) => (<li key={u.sku}><b>{u.sku}</b> {u.title}: {money(u.price)} vs cost {money(u.cost)} ({u.marginPct}%)</li>))}</ul>
        </>) : null}
        {g.pricing.aboveRetail.length ? (<>
          <h3>Priced above their own retail</h3>
          <ul>{g.pricing.aboveRetail.map((u) => (<li key={u.sku}><b>{u.sku}</b> {u.title}: {money(u.price)} vs retail {money(u.retail)}</li>))}</ul>
        </>) : null}
        {!g.pricing.stale.length && !g.pricing.thin.length && !g.pricing.aboveRetail.length ? <p>Nothing to flag.</p> : null}
        <p style={{ fontSize: 12 }}>Changing a price goes through <Link href="/admin/clearance">Clearance</Link> or the tracker, with the usual floors. This page changes nothing.</p>
      </div>

      {b.open.length ? (
        <div className="panel">
          <h2 style={{ marginTop: 0 }}>Also open</h2>
          <ul>{b.open.map((i) => (<li key={i.key}>{i.title}</li>))}</ul>
        </div>
      ) : null}
    </div>
  );
}
