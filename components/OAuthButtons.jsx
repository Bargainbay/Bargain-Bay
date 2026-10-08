// "Continue with Google / Microsoft". Plain links: the flow is a full-page
// redirect, so there is nothing for the browser to run. Renders nothing until a
// provider has credentials, so it can ship before the keys exist.
export default function OAuthButtons({ providers = [], next = '/account', verb = 'Continue' }) {
  if (!providers.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      {providers.map((p) => (
        <a key={p.id} className="btn block" style={{ marginBottom: 8, textAlign: 'center' }}
           href={`/api/auth/oauth/${p.id}?next=${encodeURIComponent(next)}`}>
          {verb} with {p.id === 'microsoft' ? 'Hotmail / Outlook (Microsoft)' : p.label}
        </a>
      ))}
      <div className="hint" style={{ textAlign: 'center', margin: '10px 0 0' }}>or use your email</div>
    </div>
  );
}
