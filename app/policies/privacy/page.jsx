export const metadata = { title: 'Privacy Policy — Bargain Bay' };

export default function PrivacyPage() {
  return (
    <div className="prose">
      <h1>Privacy Policy</h1>
      <p>
        Bargain Bay (&quot;we,&quot; &quot;us,&quot; &quot;our&quot;), operated by RS Solutions, respects your
        privacy. This policy explains what personal information we collect when you visit or buy from our online
        store, how we use it, and your rights under Canada&apos;s <b>Personal Information Protection and
        Electronic Documents Act (PIPEDA)</b> and applicable Ontario law.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li><b>Information you give us:</b> name, email, phone, billing/shipping/pickup address, order details, account credentials, and the content of your messages to us.</li>
        <li><b>Payment information:</b> handled by our payment provider (Stripe). We do <b>not</b> store full card numbers.</li>
        <li><b>Information collected automatically:</b> device and browser type, IP address, pages viewed, referring site, and similar analytics, via cookies and our e-commerce platform.</li>
      </ul>

      <h2>How we use your information</h2>
      <ul>
        <li>Process and fulfill orders, arrange pickup/delivery/freight, and provide warranty and returns support.</li>
        <li>Communicate with you about orders and inquiries, and — with your consent — send new-lot and deal emails.</li>
        <li>Operate, secure, and improve our store, prevent fraud, and meet legal, tax, and accounting obligations.</li>
      </ul>

      <h2>How we share information</h2>
      <p>We share personal information only as needed, with:</p>
      <ul>
        <li><b>Payment processors</b> (Stripe) to take payment;</li>
        <li><b>Plaid</b>, which connects our own business bank accounts to our bookkeeping (see &ldquo;Business bank data&rdquo; below);</li>
        <li><b>Our hosting and e-commerce infrastructure</b>, which processes data on our behalf;</li>
        <li><b>Delivery and freight carriers</b> to get your order to you;</li>
        <li><b>Service providers</b> (e.g., email and analytics tools) bound by confidentiality;</li>
        <li><b>Authorities</b> when required by law.</li>
      </ul>
      <p>We do <b>not</b> sell your personal information.</p>

      <h2>Business bank data</h2>
      <p>
        We use Plaid Technologies, Inc. (&ldquo;Plaid&rdquo;) to connect <b>our own business bank accounts</b> to our
        bookkeeping. This is the company&apos;s account information, not a customer&apos;s: only our administrators
        link an account, and customers are never asked to connect a bank to Bargain Bay.
      </p>
      <p>
        Through Plaid we receive the transactions on those accounts (date, amount and description). We use them to
        record business expenses, match incoming payments, prepare tax and HST filings, and keep our financial
        records. Because we are paid by e-transfer and other transfers, a transaction may include the name of the
        person or business that paid us, or that we paid; we use that only to match the payment to an order or
        invoice and to keep our books.
      </p>
      <p>
        We never see or store anyone&apos;s online banking username or password; they are entered into Plaid&apos;s
        secure window. We hold only an access token and the transaction data, protected as described in
        &ldquo;Data retention &amp; security&rdquo;, and available only to authorised people (our administrators, whose
        accounts sign in with two-step verification, and our accountant). Plaid handles the data it processes under its own privacy policy
        (<a href="https://plaid.com/legal/" style={{ textDecoration: 'underline' }}>plaid.com/legal</a>). We keep
        bank transaction records as accounting records for six years, as Canadian tax law requires, and remove the
        bank connection when we no longer need it.
      </p>

      <h2>Cookies</h2>
      <p>
        Our store uses cookies and similar technologies for cart and checkout, login sessions, analytics, and —
        with consent — marketing. You can manage cookies in your browser settings; some features may not work
        properly without them.
      </p>

      <h2>Marketing email and texts</h2>
      <p>
        We send marketing messages only where Canada&apos;s Anti-Spam Legislation (CASL) allows it: you ticked the
        box asking for them, or you bought from us in the last 24 months, or you asked us for a quote in the
        last 6 months. Marketing texts are sent only if you expressly asked for them.
      </p>
      <p>
        <b>Every marketing email carries an unsubscribe link</b>, and it keeps working indefinitely. You can also
        use the Unsubscribe button your email provider shows next to our name. For texts, reply <b>STOP</b>.
        Opting out is recorded immediately and is permanent — buying from us again afterwards does not put you
        back on the list.
      </p>
      <p>
        Opting out of marketing does not stop messages about an order you have placed — confirmations, invoices
        and delivery updates. Those are not marketing and we cannot switch them off while an order is live.
      </p>
      <p>
        We keep a record of when you opted in or out, and of the wording you were shown at the time, because
        CASL requires us to be able to show why we contacted you. You can ask us what that record says at
        {' '}<a href="mailto:sales@bargainbay.ca">sales@bargainbay.ca</a>.
      </p>

      <h2>Data retention &amp; security</h2>
      <p>
        We keep personal information only as long as needed for the purposes above and to meet legal and tax
        requirements, then delete or anonymize it. We use reasonable safeguards to protect your information,
        though no method of transmission or storage is 100% secure.
      </p>

      <h2>Your rights</h2>
      <p>
        Under PIPEDA you may request access to, or correction of, your personal information, and may withdraw
        consent (subject to legal or contractual limits). Contact us using the details below.
      </p>

      <h2>Children</h2>
      <p>
        Our store is intended for adults. We do not knowingly collect personal information from anyone under the
        age of majority in their province.
      </p>

      <h2>Changes to this policy</h2>
      <p>We may update this policy from time to time; material changes will be posted here.</p>

      <h2>Contact us</h2>
      <p>
        Privacy questions or requests:{' '}
        <a href="mailto:Service@rssolutions.ca" style={{ textDecoration: 'underline' }}>Service@rssolutions.ca</a><br />
        Bargain Bay / RS Solutions, 1135 Squires Beach Rd, Pickering, ON L1W 3T9.
      </p>
    </div>
  );
}
