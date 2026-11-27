import {
  FINAL_SALE_OVER_PCT, DOA_REPORT_HOURS, CHANGE_OF_MIND_DAYS, REFUND_FEE_PCT, RETURN_RULES_DATE_WORDS
} from '../../../lib/return-rules';

export const metadata = { title: 'Returns & Refund Policy — Bargain Bay' };

export default function ReturnsPage() {
  return (
    <div className="prose">
      <h1>Returns &amp; Refund Policy</h1>
      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        Applies to purchases made on or after {RETURN_RULES_DATE_WORDS}. Earlier purchases keep the terms printed on
        their invoice.
      </p>
      <p>
        Bargain Bay sells overstock, open-box, refurbished, and scratch-and-dent appliances at liquidation prices,
        often 30% to 70% off retail. <b>Please read this before you buy.</b>
      </p>

      <h2>The short version</h2>
      <ul>
        <li><b>More than {FINAL_SALE_OVER_PCT}% off retail is final sale.</b> No returns, no refunds, no exchanges.</li>
        <li><b>All refunds are subject to a {REFUND_FEE_PCT}% restocking fee.</b></li>
        <li><b>Dead on arrival:</b> report it within <b>{DOA_REPORT_HOURS} hours</b> of pickup or delivery for an exchange.</li>
      </ul>

      <h2>Final sale — no refunds, no exchanges</h2>
      <p>
        <b>Any item sold for more than {FINAL_SALE_OVER_PCT}% off its retail price is automatically final sale.</b> So
        is any item marked <b>&quot;Final Sale&quot;</b> or <b>&quot;As-Is&quot;</b>. Final sale items cannot be
        returned, refunded or exchanged, including for change of mind, fit, colour or finish.
      </p>
      <p>
        The discount is measured before tax, against the retail price shown on the listing or recorded for the unit,
        after any promo code or discount. For example, an appliance with a $2,500 retail price sold for $1,000 is 60%
        off, so it is final sale. Final sale items are marked on the product page and on your invoice.
      </p>
      <p>
        The one exception is a unit that is dead on arrival, below. The warranty also still applies where your invoice
        shows one. Please measure your space and doorways, and confirm fuel type, hinge side and finish, before you buy.
      </p>

      <h2>Dead on arrival (DOA)</h2>
      <p>
        If a unit does not power on or does not perform its main function when you receive it, you must report it
        within <b>{DOA_REPORT_HOURS} hours of pickup or delivery</b>, with your order or invoice number and photos or
        video. This applies to final sale items too.
      </p>
      <ul>
        <li>A confirmed DOA unit is eligible for <b>exchange</b> for the same or a comparable unit. We may repair it instead if that is quicker and you agree.</li>
        <li>If we have no comparable unit, you receive <b>store credit</b> for what you paid for it.</li>
        <li>DOA does not entitle you to a cash refund.</li>
        <li>After {DOA_REPORT_HOURS} hours, a fault is handled under the warranty (repair or replace).</li>
        <li>Not DOA: damage after you received it, incorrect installation, wrong fuel or venting, a refrigerator not left upright for 12 hours before plugging in, or cosmetic condition.</li>
      </ul>

      <h2>Inspect your item right away</h2>
      <p>
        Inspect your appliance at pickup or on delivery. <b>Report shipping damage, missing parts, a wrong model, or a
        major defect that was not disclosed within {DOA_REPORT_HOURS} hours</b>, with photos. We will repair, supply
        the part, or exchange the unit. If we sent you the wrong item or one materially different from its
        description and cannot replace it, we refund it in full. Reports after {DOA_REPORT_HOURS} hours may be refused.
      </p>
      <p>
        Cosmetic defects (scratches, dents, minor missing pieces) described on the listing or visible when you inspect
        the unit are accepted at the time of purchase and are not grounds for a return. Any cost for missing parts is
        the customer&apos;s responsibility.
      </p>

      <h2>Change of mind (items {FINAL_SALE_OVER_PCT}% off or less)</h2>
      <p>
        An item that is <b>not</b> final sale may be returned within <b>{CHANGE_OF_MIND_DAYS} days of receipt</b>,
        provided it is:
      </p>
      <ul>
        <li><b>Uninstalled and unused</b> — not connected to water, gas, or power beyond its initial test; and</li>
        <li>In the <b>same condition</b> as received, with all parts, manuals, and accessories.</li>
      </ul>
      <p>You are responsible for <b>return transport</b> (or our pickup fee).</p>

      <h2>Refunds</h2>
      <p>
        <b>Every refund is subject to a {REFUND_FEE_PCT}% restocking fee.</b> Delivery, installation, haul-away and
        freight charges are not refundable once the service has been performed. Approved refunds are issued to your
        original payment method, or as store credit, within <b>5–10 business days</b> after we receive and inspect the
        item. If <b>we</b> cancel your order because we cannot supply it, you get back everything you paid.
      </p>

      <h2>Deposits and cancellations</h2>
      <p>
        <b>Deposits are non-refundable.</b> If you cancel an order before delivery or pickup, we deduct a{' '}
        <b>{REFUND_FEE_PCT}% restocking fee</b> and issue the balance as <b>store credit</b>.
      </p>

      <h2>Warranty (separate from returns)</h2>
      <p>
        Every covered appliance includes a <b>one-year warranty</b>: if it stops working under normal household use
        within one year of purchase, we will repair or replace it. The warranty covers functional failure — not
        cosmetic wear, customer damage, or improper installation. It is not a refund.
      </p>
      <p>
        <b>Refurbished units carry a 3-month warranty</b> on the same terms: if one stops working under normal
        household use within three months of purchase, we will repair or replace it.
      </p>

      <h2>Items sold by marketplace sellers</h2>
      <p>
        Some units are sold by approved sellers on our marketplace; the listing says <b>&quot;Sold by&quot;</b> and
        names the seller. Everything on this page applies to them too, including final sale. Report a problem to{' '}
        <b>us</b> within {DOA_REPORT_HOURS} hours and we will deal with the seller. Their <b>warranty</b> is the
        seller&apos;s promise (at least one year), and claims go through us. Marketplace units are not eligible for
        promo codes or member pricing, and a unit shipped by its seller can&apos;t be collected from our warehouse.
      </p>

      <h2>Appliance care</h2>
      <ul>
        <li>Gas (LP/NG) appliances must be installed and leak-tested by a licensed gas fitter.</li>
        <li>Refrigeration must stand upright for 12 hours after delivery before being plugged in.</li>
        <li>Products that use water must not be exposed to sub-zero temperatures.</li>
      </ul>
      <p>We will never ask for your credit card details by email or phone.</p>

      <h2>How to report a problem or start a claim</h2>
      <p>
        Email <a href="mailto:Service@rssolutions.ca" style={{ textDecoration: 'underline' }}>Service@rssolutions.ca</a> with
        your <b>order or invoice number</b>, the <b>item/model</b>, a description of the issue, and <b>photos</b>.
        We&apos;ll reply within 1–2 business days with next steps; what counts for the {DOA_REPORT_HOURS}-hour limit is
        when your email reaches us. Approved returns can be dropped off at or picked up from our warehouse:
      </p>
      <p><b>Bargain Bay — 1135 Squires Beach Rd, Pickering, ON L1W 3T9</b> (by appointment).</p>

      <p style={{ fontSize: 13, color: 'var(--muted)' }}>
        <em>This policy does not override your non-waivable rights under the Ontario Consumer Protection Act and
        applicable Canadian law.</em>
      </p>
    </div>
  );
}
