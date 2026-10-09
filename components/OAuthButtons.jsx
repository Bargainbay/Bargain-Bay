'use client';
import { useState } from 'react';
import MarketingOptIn from './MarketingOptIn';

// "Continue with Google / Microsoft". Plain links: the flow is a full-page
// redirect. Renders nothing until a provider has credentials.
//
// The marketing opt-in sits ABOVE the buttons, UNTICKED, and rides the redirect
// as ?optin=1 (the start route keeps it in the httpOnly state cookie). The
// callback records consent only for a NEWLY created account and only if this
// was ticked. Signing in with Google/Microsoft is not a yes to marketing.
export default function OAuthButtons({ providers = [], next = '/account', verb = 'Continue' }) {
  const [optIn, setOptIn] = useState(false);
  if (!providers.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <MarketingOptIn id="oauth-marketing" checked={optIn} onChange={setOptIn} />
      <div style={{ height: 10 }} />
      {providers.map((p) => (
        <a key={p.id} className="btn block" style={{ marginBottom: 8, textAlign: 'center' }}
           href={`/api/auth/oauth/${p.id}?next=${encodeURIComponent(next)}${optIn ? '&optin=1' : ''}`}>
          {verb} with {p.id === 'microsoft' ? 'Hotmail / Outlook (Microsoft)' : p.label}
        </a>
      ))}
      <div className="hint" style={{ textAlign: 'center', margin: '10px 0 0' }}>or use your email</div>
    </div>
  );
}
