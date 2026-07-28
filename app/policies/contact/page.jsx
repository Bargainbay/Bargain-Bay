export const metadata = { title: 'Contact Us — Bargain Bay' };

export default function ContactPage() {
  return (
    <div className="prose">
      <h1>Contact Bargain Bay</h1>
      <p>
        Bargain Bay is operated by <b>RS Solutions</b>. We&apos;re happy to help with orders, pickup and
        delivery, warranty, and returns.
      </p>
      <ul>
        <li><b>Sales &amp; orders:</b> <a href="mailto:sales@bargainbay.ca" style={{ textDecoration: 'underline' }}>sales@bargainbay.ca</a></li>
        <li><b>Service, returns &amp; warranty:</b> <a href="mailto:Service@rssolutions.ca" style={{ textDecoration: 'underline' }}>Service@rssolutions.ca</a></li>
        <li><b>Warehouse / mailing address:</b> 1135 Squires Beach Rd, Pickering, ON L1W 3T9, Canada</li>
        <li><b>Hours:</b> 10am–8pm</li>
      </ul>
      <p>We typically reply within <b>1–2 business days</b>.</p>

      <h2>Who to contact for what</h2>
      <ul>
        <li><b>Orders &amp; general questions</b> — sales@bargainbay.ca</li>
        <li><b>Pickup or delivery scheduling</b> — reply to your order confirmation, or email us with your order number</li>
        <li><b>Returns &amp; warranty claims</b> — Service@rssolutions.ca with your order number, the model, a description of the issue, and photos (see our <a href="/policies/returns" style={{ textDecoration: 'underline' }}>Returns &amp; Refund Policy</a>)</li>
        <li><b>Privacy requests</b> — Service@rssolutions.ca (see our <a href="/policies/privacy" style={{ textDecoration: 'underline' }}>Privacy Policy</a>)</li>
      </ul>

      <blockquote>
        Pickup is <b>by appointment</b> at the Pickering warehouse — please don&apos;t visit without a confirmed time.
      </blockquote>

      <h2>Track an order</h2>
      <p>
        Use the tracking link in your confirmation email, or <a href="/account" style={{ textDecoration: 'underline' }}>log in to your account</a> to
        see live order status.
      </p>
    </div>
  );
}
