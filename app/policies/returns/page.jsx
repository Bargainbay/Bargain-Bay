export const metadata = { title: 'Returns & Refund Policy — Bargain Bay' };

export default function ReturnsPage() {
  return (
    <div className="prose">
      <h1>Returns &amp; Refund Policy</h1>
      <p>
        Bargain Bay sells overstock, open-box, refurbished, and scratch-and-dent appliances at liquidation
        prices. Every unit is bench-tested before it&apos;s listed, and its condition — including any cosmetic
        imperfections — is described on the product page. Because these are discounted liquidation items, our
        return terms differ from a full-price retailer. That said, we stand behind everything we sell with a{' '}
        <b>one-year functional warranty</b> and the protections below.
      </p>

      <h2>Inspect your item right away</h2>
      <p>
        Please inspect your appliance at pickup or on delivery. <b>Report any shipping damage, missing parts,
        or visible defects within 48 hours</b> of receiving it, with photos. After 48 hours we may be unable to
        cover transit damage.
      </p>

      <h2>Doesn&apos;t work on arrival (DOA)</h2>
      <p>
        If a unit doesn&apos;t power on or function as tested when you receive it, contact us <b>within 48
        hours</b>. We&apos;ll arrange a repair, a replacement (if available), or a <b>full refund</b> — your
        choice, at no cost to you.
      </p>

      <h2>Not as described</h2>
      <p>
        If an item is materially different from its listing (wrong model, or an undisclosed major defect), let
        us know within <b>7 days</b> and we&apos;ll make it right with an exchange or full refund, including
        reasonable return transport.
      </p>

      <h2>Change of mind</h2>
      <p>Appliances may be returned for a change of mind within <b>14 days of receipt</b>, provided the unit is:</p>
      <ul>
        <li><b>Uninstalled and unused</b> — not connected to water, gas, or power beyond its initial test; and</li>
        <li>In the <b>same condition</b> as received, with all parts, manuals, and accessories.</li>
      </ul>
      <p>
        Change-of-mind returns are subject to a <b>20% restocking fee</b>, and the customer is responsible for{' '}
        <b>return transport</b> (or our pickup fee). Refunds are issued to the original payment method, minus
        those fees, after the unit is inspected back at our warehouse.
      </p>

      <h2>One-year warranty (separate from returns)</h2>
      <p>
        Every covered appliance includes a <b>one-year warranty</b>: if it stops working under normal household
        use within one year of purchase, we will repair or replace it. The warranty covers functional failure —
        not cosmetic wear, customer damage, or improper installation.
      </p>

      <h2>Final-sale / non-returnable items</h2>
      <p>The following are <b>not eligible for change-of-mind returns</b> (DOA and warranty coverage still apply where noted):</p>
      <ul>
        <li>Items clearly marked <b>&quot;As-Is&quot; or &quot;Final Sale&quot;</b>;</li>
        <li>Units that have been <b>installed, used, or modified</b> (except valid DOA or warranty claims);</li>
        <li>Damage occurring after delivery (mishandling, improper installation, power surge, etc.);</li>
        <li>Returns missing parts, manuals, or accessories.</li>
      </ul>

      <h2>How to start a return or claim</h2>
      <p>
        Email <a href="mailto:Service@rssolutions.ca" style={{ textDecoration: 'underline' }}>Service@rssolutions.ca</a> with
        your <b>order number</b>, the <b>item/model</b>, a description of the issue, and <b>photos</b>. We&apos;ll
        reply within 1–2 business days with next steps. Approved returns can be dropped off at or picked up from
        our warehouse:
      </p>
      <p><b>Bargain Bay — 2764 Governors Road, Lynden, ON L0R 1T0</b> (by appointment).</p>

      <h2>Refunds</h2>
      <p>
        Once we receive and inspect a returned item, approved refunds are processed to your original payment
        method within <b>5–10 business days</b>. Original delivery or freight charges are non-refundable except
        on DOA or not-as-described claims.
      </p>

      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        <em>This policy does not override your non-waivable rights under the Ontario Consumer Protection Act and
        applicable Canadian law.</em>
      </p>
    </div>
  );
}
