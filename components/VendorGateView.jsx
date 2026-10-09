// What a signed-in user sees when they are not a vendor (or the database is missing).
export default function VendorGateView({ view, email }) {
  if (view === 'nodb') return <div className="narrow"><div className="panel">Database not configured — set POSTGRES_URL.</div></div>;
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
