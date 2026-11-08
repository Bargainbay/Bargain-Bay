import { DELIVERY_ZONES, PER_KM_BEYOND } from '../../../lib/delivery-zones';

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
        We deliver throughout Durham Region, the GTA, and surrounding areas. Online checkout prices delivery by the
        driving distance from our Pickering warehouse to your address, and shows the fee before you pay:
      </p>
      {/* These come from DELIVERY_ZONES (lib/delivery-zones.js), the same rate-sheet zones app/api/checkout
          charges — they are NOT typed in here. The owner can change a zone's price in the service price
          catalog, so this table shows the standard rate sheet and the checkout shows the live figure. */}
      <table>
        <thead><tr><th>Distance from Pickering</th><th>Delivery fee</th></tr></thead>
        <tbody>
          {DELIVERY_ZONES.map((z) => (
            <tr key={z.zone}><td>{z.label.replace(/^Zone \w \(|\)$/g, '')}</td><td><b>${z.fee}</b></td></tr>
          ))}
          <tr><td>Beyond 150 km</td><td>Zone C plus ${PER_KM_BEYOND} per km past 150</td></tr>
        </tbody>
      </table>
      <ul>
        <li><b>Free local delivery on orders over $5,000</b> (goods, after any discount, before tax) to addresses within 150 km of Pickering. Beyond 150 km the per-km charge still applies.</li>
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
