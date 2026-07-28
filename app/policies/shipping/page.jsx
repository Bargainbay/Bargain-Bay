export const metadata = { title: 'Shipping & Delivery Policy — Bargain Bay' };

export default function ShippingPage() {
  return (
    <div className="prose">
      <h1>Shipping &amp; Delivery Policy</h1>
      <p>
        We want your appliance to reach you safely and affordably. Here&apos;s how pickup, local delivery, and
        freight work.
      </p>

      <h2>Free warehouse pickup</h2>
      <p>Pick up any order <b>free</b> at our warehouse, <b>by appointment</b>:</p>
      <p><b>Bargain Bay — 1135 Squires Beach Rd, Pickering, ON L1W 3T9</b></p>
      <p>
        After you order, we&apos;ll confirm a pickup time by email. Please bring your order confirmation and
        photo ID, and a vehicle/help suited to the size of the appliance.
      </p>

      <h2>Local delivery</h2>
      <p>
        We deliver throughout Durham Region, the GTA, and surrounding areas. Online checkout offers flat-rate{' '}
        <b>$75 local delivery</b> for addresses within roughly 50 km of our Pickering warehouse. Farther out is
        priced by distance:
      </p>
      <table>
        <thead><tr><th>Distance from Pickering</th><th>Delivery fee</th></tr></thead>
        <tbody>
          <tr><td>0–50 km</td><td><b>$75</b></td></tr>
          <tr><td>51–100 km</td><td><b>$125</b> (by arrangement — email us)</td></tr>
          <tr><td>101–150 km</td><td><b>$175</b> (by arrangement — email us)</td></tr>
        </tbody>
      </table>
      <ul>
        <li><b>Free local delivery on orders over $5,000.</b></li>
        <li>Delivery is to your door/ground floor. We are not responsible for installation, hookup (water/gas/electrical), or removal of old units unless arranged in advance.</li>
      </ul>

      <h2>Freight &amp; out-of-area (150 km+)</h2>
      <p>
        For deliveries beyond 150 km or for oversized items outside our local zone, we arrange <b>freight by
        quote</b>. Choose pickup at checkout or contact us at{' '}
        <a href="mailto:Service@rssolutions.ca" style={{ textDecoration: 'underline' }}>Service@rssolutions.ca</a> with your
        postal code, and we&apos;ll provide a freight quote before you pay.
      </p>

      <h2>Processing &amp; scheduling</h2>
      <p>
        Because each unit is one-of-a-kind and inspected before it ships, orders are typically prepared within{' '}
        <b>1–3 business days</b>. We&apos;ll email you to schedule delivery or pickup. Delivery windows are
        estimates and can be affected by weather, access, and carrier schedules.
      </p>

      <h2>Before delivery day — please check</h2>
      <ul>
        <li><b>Measure</b> your doorways, hallways, and the spot where the appliance will go.</li>
        <li>Ensure a <b>clear, safe path</b> for our team.</li>
        <li>Someone <b>18+</b> must be present to receive and sign for the delivery.</li>
      </ul>
      <p>Missed or failed deliveries (no access, no one present, unit won&apos;t fit) may incur a <b>re-delivery fee</b>.</p>

      <h2>Inspect on arrival</h2>
      <p>
        Please inspect your appliance at pickup or on delivery and <b>report any shipping damage or missing
        parts within 48 hours</b>, with photos (see our <a href="/policies/returns" style={{ textDecoration: 'underline' }}>Returns &amp;
        Refund Policy</a>). Title and risk of loss pass to you on pickup or on delivery to your address.
      </p>

      <h2>Areas we serve</h2>
      <p>Ontario — local delivery around Durham/GTA per the zones above; freight available farther out by quote.</p>

      <h2>Questions</h2>
      <p>
        <a href="mailto:Service@rssolutions.ca" style={{ textDecoration: 'underline' }}>Service@rssolutions.ca</a> — Bargain Bay /
        RS Solutions, 1135 Squires Beach Rd, Pickering, ON L1W 3T9.
      </p>
    </div>
  );
}
