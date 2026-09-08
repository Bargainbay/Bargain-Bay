'use client';
import { useState } from 'react';
import InvoiceLines, { fromInvoice, toPayload } from './InvoiceLines';
import TaxMode, { previewTotals, modeOf, NO_TAX } from './TaxMode';
import { toInclusiveLines } from '../lib/tax';
import { isCreditLine } from '../lib/invoice-lines';

// Edit an invoice: the customer's details, the line items (add, remove, reprice,
// change warranty, add a service or a unit from stock), HST, memo and issue date.
// Works on a settled invoice too — correcting a three-month-old sale adjusts that
// sale in the month it happened, rather than booking anything new today.
// Saves via PATCH action 'edit'.
const SERVICES = ['Installation', 'Delivery', 'Door Removal'];
const fmtMoney = (n) => '$' + (Number(n) || 0).toFixed(2);

export default function InvoiceEditor({ invoice, inventory = [] }) {
  const status = invoice.status || 'open';
  const settled = status === 'paid';
  const paidSoFar = Number(invoice.amountPaid) || 0;
  const originalTotal = Number(invoice.total) || 0;
  const [name, setName] = useState(invoice.name || '');
  const [email, setEmail] = useState(invoice.email || '');
  const [phone, setPhone] = useState(invoice.phone || '');
  const [deliveryMethod, setDeliveryMethod] = useState(invoice.deliveryMethod === 'delivery' ? 'delivery' : 'pickup');
  const [address, setAddress] = useState(invoice.address || '');
  const [city, setCity] = useState(invoice.city || '');
  const [postal, setPostal] = useState(invoice.postal || '');
  // Reopen in the terms it was quoted in. Stored line amounts are ALWAYS pre-tax;
  // an invoice keyed tax-in is shown back as the figures the rep typed, or they
  // open a $1,000 sale and find $884.96 in the box.
  const [taxMode, setTaxMode] = useState(() => modeOf(Number(invoice.hst) > 0, invoice.taxInclusive));
  const [items, setItems] = useState(() => {
    const rows = fromInvoice(invoice.items);
    if (!invoice.taxInclusive || !(Number(invoice.hst) > 0)) return rows;
    // A tax-in invoice raised since we started keeping typed_amount comes back
    // exactly as it was keyed — nothing to reconstruct.
    if (rows.every((r) => r.typedAmount != null)) return rows;
    // Older ones only have the pre-tax amounts, so the tax-in figures have to be
    // derived, and a derivation cannot land on the cent — the split moved a
    // rounding cent onto the biggest line and grossing back up can't put it back.
    // All-or-nothing on purpose: deriving only SOME rows would leave the boxes
    // not adding up to the invoice total.
    //
    // toInclusiveLines works in the SIGNED amounts an invoice is stored in, so
    // the credits have to go back to negative first. fromInvoice hands them over
    // positive, the way the form shows them, and feeding those straight in made
    // a $50 trade-in read as +$50: the total it was reconciling against was then
    // $100 adrift, and the fix-up spread that error across every line. A washer
    // typed at $750 came back as $716.65.
    const shown = toInclusiveLines(toPayload(rows).map((r) => Number(r.amount) || 0), Number(invoice.total) || null);
    return rows.map((r, i) => ({ ...r, amount: (isCreditLine(r.kind) ? Math.abs(shown[i]) : shown[i]).toFixed(2) }));
  });
  // A salvage / parts-only invoice was raised with no HST on it. Re-saving one
  // must not quietly add 13% to a sale that's already been settled.
  const addHst = taxMode !== NO_TAX;
  const [memo, setMemo] = useState(invoice.memo || '');
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate || '');
  const todayToronto = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  // The invoice email is a payment request, so it's only offered — and only
  // pre-ticked — while money is still owed.
  const [resend, setResend] = useState(!settled);

  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = q.trim().length >= 2 ? inventory.filter((u) => tokens.every((t) => u.search.includes(t))).slice(0, 8) : [];
  function pickInventory(u) {
    setItems((xs) => [...xs, { description: u.description, amount: String(u.price), sku: u.id, kind: 'unit', warrantyMonths: 12 }]);
    setQ('');
  }

  const signed = toPayload(items).map((it) => Number(it.amount) || 0);
  const preview = previewTotals(signed, taxMode);
  const { subtotal, hst, total } = preview;

  // Same as the new-invoice form: switching only re-reads what's in the boxes,
  // it never rewrites them. Choosing "prices include HST" on 750 + 100 - 50
  // makes this an $800 sale with the tax backed out of it, not an $800 subtotal
  // grossed up to $904. The boxes still open showing the figures the rep
  // originally typed (see the items initialiser above) — that part is display,
  // and stays.
  const changeTaxMode = setTaxMode;
  const fmt = (n) => '$' + n.toFixed(2);
  // How this edit lands: which way the sale moves, and where that leaves the
  // customer against what they've already handed over.
  const delta = total - originalTotal;
  const owing = Math.max(0, total - paidSoFar);
  const overpaid = Math.max(0, paidSoFar - total);

  async function save() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/admin/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id, action: 'edit', items: toPayload(items), addHst,
          taxInclusive: taxMode === 'inclusive', memo,
          resend: resend && !settled,
          name, email, phone, deliveryMethod, address, city, postal,
          // Only send a date the owner actually changed — sending the original
          // back unchanged would still re-stamp created_at to noon that day.
          invoiceDate: invoiceDate !== (invoice.invoiceDate || '') ? invoiceDate : '' })
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not save.'); return; }
      if (d.emailError) {
        // Saved, but the email didn't go out — stay on the page so it's seen.
        setErr(`Saved, but the email failed: ${d.emailError} Use “Resend email” on the invoice list to retry.`);
        return;
      }
      setDone(d.emailed ? `✓ Saved — updated invoice emailed to ${invoice.email}. Returning…` : '✓ Saved. Returning to invoices…');
      setTimeout(() => { window.location.href = '/admin/invoices'; }, 900);
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <div className="notice-box">{done}</div>;

  return (
    <div>

      {settled && (
        <div className="notice-box" style={{ marginTop: 0 }}>
          This invoice is <b>paid</b>. Correcting it adjusts the original sale <b>on its own date</b> —
          drop a $1,500 line to $1,300 and that month&apos;s revenue moves by −$200. Nothing is booked today
          and nothing is counted twice.
          <div style={{ marginTop: 4 }}>
            Repricing a line leaves its unit sold and off the website. Only <b>removing</b> a line puts that
            unit back on sale.
          </div>
        </div>
      )}

      <div className="form-2col">
        <div className="field">
          <label>Customer name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" />
        </div>
        <div className="field">
          <label>Customer email *</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" autoComplete="off" />
        </div>
      </div>

      <div className="field">
        <label>Fulfilment</label>
        <div style={{ display: 'flex', gap: 18, margin: '2px 0 6px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 400 }}>
            <input type="radio" name="edm" style={{ width: 'auto' }} checked={deliveryMethod === 'pickup'} onChange={() => setDeliveryMethod('pickup')} /> Pickup
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 400 }}>
            <input type="radio" name="edm" style={{ width: 'auto' }} checked={deliveryMethod === 'delivery'} onChange={() => setDeliveryMethod('delivery')} /> Delivery
          </label>
        </div>
        {deliveryMethod === 'delivery' && (
          <div style={{ marginTop: 4 }}>
            <input style={{ marginBottom: 8 }} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" />
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
              <input style={{ width: 150 }} value={postal} onChange={(e) => setPostal(e.target.value)} placeholder="Postal code" />
            </div>
          </div>
        )}
        <input style={{ marginTop: 8 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Customer phone (optional)" />
        <div className="hint">These flow onto the matching BB order too, so the two never disagree.</div>
      </div>

      {inventory.length > 0 && (
        <div className="field">
          <label>Add a unit from inventory</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stock by model, name, or SKU…" />
          {matches.length > 0 && (
            <div style={{ border: '1px solid var(--line)', borderRadius: 8, marginTop: 4, maxHeight: 230, overflowY: 'auto' }}>
              {matches.map((u) => (
                <button type="button" key={u.id} onClick={() => pickInventory(u)}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12, width: '100%', textAlign: 'left', padding: '8px 11px', background: 'none', border: 'none', borderBottom: '1px solid var(--line-soft)', cursor: 'pointer', fontSize: 13.5, color: 'var(--ink)' }}>
                  <span>{u.description}</span>
                  <span style={{ whiteSpace: 'nowrap', color: 'var(--muted)', fontWeight: 600 }}>${u.price.toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <InvoiceLines items={items} setItems={setItems} services={SERVICES} />

      <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 12px' }}>
        <TaxMode mode={taxMode} onChange={changeTaxMode} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
          title="Backdate for a sale rung up late — the invoice shows this date. Revenue counts on the PAID date, set when you mark it paid.">
          Invoice date
          <input style={{ width: 150 }} type="date" max={todayToronto} value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </label>
      </div>

      <div className="field">
        <label>Memo / notes (optional)</label>
        <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Shown on the invoice" />
      </div>

      {/* What this edit actually does to the money, before it's saved. */}
      {(Math.abs(total - originalTotal) > 0.005 || paidSoFar > 0) && (
        <div className={overpaid > 0.005 ? 'error-box' : 'notice-box'} style={{ lineHeight: 1.6 }}>
          {Math.abs(total - originalTotal) > 0.005 && (
            <div>
              Total {delta < 0 ? 'drops' : 'rises'} from <b>{fmtMoney(originalTotal)}</b> to <b>{fmtMoney(total)}</b> —
              this sale&apos;s revenue moves by <b>{delta < 0 ? '−' : '+'}{fmtMoney(Math.abs(delta))}</b>
              {invoice.invoiceDate ? <> on <b>{invoice.invoiceDate}</b>, its original date</> : null}.
            </div>
          )}
          {paidSoFar > 0 && (
            <div>
              {fmtMoney(paidSoFar)} received so far.{' '}
              {overpaid > 0.005
                ? <b>You&apos;ll owe the customer {fmtMoney(overpaid)} back</b>
                : owing > 0.005
                  ? <>The invoice will show <b>{fmtMoney(owing)} still owing</b>{settled ? ' and go back to part-paid' : ''}.</>
                  : <>That covers it in full.</>}
            </div>
          )}
          {overpaid > 0.005 && (
            <div style={{ marginTop: 4 }}>
              Saving records the corrected sale. Handing the money back is a separate step —
              this doesn&apos;t move any cash on its own.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>
          Subtotal {fmt(subtotal)}{addHst ? ` · HST ${fmt(hst)}` : ''} · <b style={{ color: 'var(--charcoal)' }}>Total {fmt(total)}</b>
          {taxMode === 'inclusive' && <span> — the {fmt(preview.quoted)} you typed</span>}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {!settled && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5 }}
              title={`Re-send the invoice email (with e-transfer instructions) to ${email} after saving`}>
              <input type="checkbox" style={{ width: 'auto' }} checked={resend} onChange={(e) => setResend(e.target.checked)} />
              Email the updated invoice
            </label>
          )}
          <a className="btn" href="/admin/invoices">Cancel</a>
          <button className="btn accent" disabled={busy} onClick={save}>{busy ? 'Saving…' : (resend && !settled) ? 'Save & email' : 'Save changes'}</button>
        </div>
        {/* With the button, not at the top of the page — see InvoiceForm. */}
        {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}
      </div>
    </div>
  );
}
