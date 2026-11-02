import { money, ETRANSFER_EMAIL, torontoDate } from '../lib/constants';

// An RS Solutions client invoice, laid out like the paper one clients already
// know: letterhead, who it is for / who to pay / number / project / date, one row
// per delivery (reference, customer, services), then GST and the totals. Every
// row that belongs to a stop is a link to that stop's proof of delivery.
const NAVY = '#2b3990', LILAC = '#6b6fe8', PINK = '#e91e8c';

export default function RsInvoiceDocument({ invoice, B, rows, portalHref, pdfHref, statusLabel, paid, open, partial, amountPaid, balance }) {
  const issued = invoice.created_at ? new Date(invoice.created_at).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'America/Toronto' }) : '';
  const address = [invoice.address, invoice.city, invoice.postal].filter(Boolean).join(', ');
  return (
    <div className="rsinv">
      <style>{`
        .rsinv { max-width: 860px; margin: 0 auto; background:#fff; color:#222; border-top: 6px solid ${NAVY}; padding: 26px 30px 34px; font-family: system-ui, Arial, sans-serif; }
        .rsinv h1 { margin:0; font-size:28px; font-weight:400; color:${LILAC}; }
        .rsinv .sm { font-size:12px; color:#666; line-height:1.5; }
        .rsinv .grid { display:grid; grid-template-columns: 1.1fr 1fr 1fr; gap: 14px 24px; margin:22px 0 14px; padding-bottom:14px; border-bottom:1px solid #ccc; }
        .rsinv .k { font-size:12px; font-weight:700; color:#333; margin-bottom:3px; }
        .rsinv table { width:100%; border-collapse:collapse; margin-top:6px; }
        .rsinv th { text-align:right; font-size:12px; color:${NAVY}; padding:8px 10px; }
        .rsinv th:first-child { text-align:left; }
        .rsinv td { padding:8px 10px; font-size:13px; text-align:right; vertical-align:middle; white-space:nowrap; }
        .rsinv td.d { text-align:center; white-space:normal; line-height:1.35; width:55%; }
        .rsinv tbody tr:nth-child(odd) { background:#f3f3f3; }
        .rsinv tr.link { cursor:pointer; }
        .rsinv tr.link:hover { background:#e8ebfa !important; }
        .rsinv td.d a { color:inherit; text-decoration:none; display:block; }
        .rsinv .pod { display:inline-block; margin-top:3px; font-size:11px; color:${NAVY}; font-weight:700; }
        .rsinv .tot { margin-left:auto; width:300px; margin-top:12px; font-size:13px; }
        .rsinv .tot div { display:flex; justify-content:space-between; padding:3px 0; }
        .rsinv .big { color:${PINK}; font-size:24px; font-weight:700; justify-content:flex-end !important; padding-top:8px !important; }
        .rsinv .bar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
        .rsinv .hint2 { font-size:12.5px; color:#555; }
        @media (max-width: 640px) { .rsinv .grid { grid-template-columns:1fr 1fr; } .rsinv td.d { width:auto; } }
        @media print { .rsinv .bar, .rsinv .noprint { display:none !important; } .rsinv { border-top-width:6px; padding:0; } }
      `}</style>

      <div className="bar">
        <a href={pdfHref} className="btn accent">Download PDF</a>
        {portalHref && <a href={portalHref} className="btn">All deliveries →</a>}
        <span className="hint2">{statusLabel}. Click any delivery below to see its proof of delivery, time on site and photos.</span>
      </div>

      <h1>{B.name}</h1>
      <div className="sm">{B.address.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3).map((x, i) => <div key={i}>{x}</div>)}<div>{B.contactEmail}</div></div>

      <div className="grid">
        <div>
          <div className="k">Invoice for</div>
          <div className="sm">{invoice.name}</div>
          {address && <div className="sm">{address}</div>}
          {invoice.phone && <div className="sm">{invoice.phone}</div>}
          {invoice.email && <div className="sm">{invoice.email}</div>}
        </div>
        <div>
          <div className="k">Payable to</div>
          <div className="sm">{B.legal}</div>
          <div className="sm">{B.contactEmail}</div>
          <div className="k" style={{ marginTop: 12 }}>Project</div>
          <div className="sm">Deliveries/Installs</div>
        </div>
        <div>
          <div className="k">Invoice #</div>
          <div className="sm">{invoice.number}</div>
          <div className="k" style={{ marginTop: 12 }}>Date</div>
          <div className="sm">{issued}</div>
          {invoice.due_date && open && <><div className="k" style={{ marginTop: 12 }}>Due</div><div className="sm">{torontoDate(invoice.due_date)}</div></>}
        </div>
      </div>

      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total price</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.href ? 'link' : ''}>
              <td className="d">
                {r.href ? (
                  <a href={r.href} title="Open proof of delivery, time on site and photos">
                    {r.lines.map((l, i) => <div key={i}>{l}</div>)}
                    <span className="pod">View proof of delivery &amp; photos →</span>
                  </a>
                ) : r.lines.map((l, i) => <div key={i}>{l}</div>)}
              </td>
              <td>1</td><td>{money(r.amount)}</td><td>{money(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="sm" style={{ borderTop: '1px solid #ccc', paddingTop: 6, textAlign: 'center' }}>GST: {B.hst.replace(/\s+/g, '')}</div>

      <div className="tot">
        <div><span style={{ color: NAVY }}>Subtotal</span><b>{money(invoice.subtotal)}</b></div>
        {Number(invoice.hst) > 0 && <div><span style={{ color: NAVY }}>tax (HST 13%)</span><span>{money(invoice.hst)}</span></div>}
        <div className="big">{money(invoice.total)}</div>
        {partial && <><div><span>Paid so far</span><span>−{money(amountPaid)}</span></div><div><b>Balance owing</b><b>{money(balance)}</b></div></>}
      </div>

      {invoice.memo && <p className="sm" style={{ marginTop: 14 }}><b style={{ color: NAVY }}>Notes:</b> {invoice.memo}</p>}

      {paid ? (
        <p className="sm noprint" style={{ marginTop: 14 }}>Paid{invoice.paid_at ? ` on ${torontoDate(invoice.paid_at)}` : ''}{invoice.payment_method ? ` · ${invoice.payment_method}` : ''} — thank you!</p>
      ) : (open || partial) && (
        <p className="sm" style={{ marginTop: 14 }}>
          <b>Pay by Interac e-Transfer</b> to {ETRANSFER_EMAIL} (auto-deposit, no security question) and put <b>{invoice.number}</b> in the message.
        </p>
      )}
    </div>
  );
}
