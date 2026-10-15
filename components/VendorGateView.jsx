// What a signed-in user sees when they are not a vendor (or the database is missing), or when
// their role does not include this page.
export default function VendorGateView({ view, email }) {
  if (view === 'nodb') return <div className="narrow"><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
  if (view === 'error') return <div className="narrow"><div className="panel">We could not check your sign-in just now. Please try again in a moment.</div></div>;
  if (view === 'forbidden') {
    return (
      <div className="narrow"><div className="panel">
        <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Not part of your role</h1>
        <p style={{ fontSize: 14 }}>
          Your role on this account does not include that page. The account owner can change your role
          from the Team page. <a href="/vendor">Back to home</a>.
        </p>
      </div></div>
    );
  }
  return (
    <div className="narrow"><div className="panel">
      <h1 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Vendor portal</h1>
      <p style={{ fontSize: 14 }}>
        {email ? <>The account <strong>{email}</strong> is not linked to a vendor.</> : 'This account is not linked to a vendor.'}{' '}
        If you have been approved, sign in with the email address we approved. Want to sell with us?{' '}
        <a href="/marketplace/sell">Apply here</a>.
      </p>
    </div></div>
  );
}
