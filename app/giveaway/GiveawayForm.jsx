'use client';
import { useEffect, useState } from 'react';
import HoneypotField, { HONEYPOT_FIELD } from '../../components/HoneypotField';
import { GIVEAWAY_EMAIL_TEXT } from '../../lib/deals-config';

// Entering takes a Bargain Bay account, our deals-and-flyers email, and this form,
// all required (see the contest rules). So the form creates the account as part of
// entering. Someone already signed in skips the email and password; someone with an
// account who is signed out is sent to log in rather than typing it in.
export default function GiveawayForm() {
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '', postal: '', eligible: false, subscribe: false, [HONEYPOT_FIELD]: '' });
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);
  const [done, setDone] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const tick = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.checked }));

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : { user: null })).then((d) => {
      if (d.user) { setMe(d.user); setF((s) => ({ ...s, name: s.name || d.user.name || '' })); }
    }).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(''); setNeedsLogin(false);
    try {
      const r = await fetch('/api/giveaway', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, marketingOptIn: f.subscribe })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(d.error || 'Could not submit your entry.'); setNeedsLogin(!!d.login); return; }
      // A new entry goes straight on to the checklist. A repeat gets no link on
      // screen (it is emailed), so it just says so.
      if (d.entered && d.e) { window.location.href = `/giveaway?e=${encodeURIComponent(d.e)}`; return; }
      setDone(true);
    } catch { setErr('Network error. Please try again.'); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className="panel" style={{ maxWidth: 520 }}>
        <h2 style={{ marginTop: 0 }}>You’re already entered.</h2>
        <p style={{ fontSize: 14.5 }}>
          There is one entry per person. We’ve emailed you the link to your checklist, where you can earn extra entries.
          Meanwhile, see <a href="/deals" style={{ textDecoration: 'underline' }}>this week’s deals</a>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="giveaway-form">
      <p style={{ margin: 0, fontSize: 14.5 }}>
        To enter you need a free Bargain Bay account and to join our deals and flyers email. No purchase needed.
      </p>
      {err && (
        <div className="error-box">
          {err}
          {needsLogin && <> <a href="/login?next=%2Fgiveaway" style={{ textDecoration: 'underline', fontWeight: 600 }}>Log in</a>.</>}
        </div>
      )}
      <HoneypotField value={f[HONEYPOT_FIELD]} onChange={set(HONEYPOT_FIELD)} />
      <label>Full name<input value={f.name} onChange={set('name')} required autoComplete="name" /></label>
      {me ? (
        <p style={{ margin: 0, fontSize: 14 }}>Entering with your account: <b>{me.email}</b></p>
      ) : (
        <>
          <label>Email<input type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></label>
          <label>Create a password<input type="password" value={f.password} onChange={set('password')} required minLength={8} autoComplete="new-password" />
            <span className="hint">At least 8 characters. This is your new Bargain Bay account.</span>
          </label>
        </>
      )}
      <label>Phone (optional)<input type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
      <label>Ontario postal code<input value={f.postal} onChange={set('postal')} required autoComplete="postal-code" placeholder="L1W 3T9" maxLength={7} /></label>
      <label className="check-line">
        <input type="checkbox" checked={f.subscribe} onChange={tick('subscribe')} required />
        <span>{GIVEAWAY_EMAIL_TEXT}</span>
      </label>
      <label className="check-line">
        <input type="checkbox" checked={f.eligible} onChange={tick('eligible')} required />
        <span>I am 18 or older, I live in Ontario, and I have read and agree to the <a href="#rules" style={{ textDecoration: 'underline' }}>contest rules</a>.</span>
      </label>
      <button className="btn primary" disabled={busy}>{busy ? 'Entering…' : me ? 'Enter the giveaway' : 'Create account & enter'}</button>
    </form>
  );
}
