'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Self-service profile: edit name/phone and change the password without
// emailing the store.
export default function AccountProfile({ profile }) {
  const router = useRouter();
  const [mode, setMode] = useState('view'); // view | edit | password
  const [f, setF] = useState({ name: profile.name || '', phone: profile.phone || '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  async function save(url, payload, doneMsg) {
    setBusy(true); setErr('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'Could not save.'); return; }
      setNotice(doneMsg);
      setMode('view');
      setPw({ current: '', next: '' });
      router.refresh();
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'edit') {
    return (
      <div>
        {err && <div className="error-box">{err}</div>}
        <div className="form-2col">
          <div className="field"><label>Name</label><input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></div>
          <div className="field"><label>Phone</label><input value={f.phone} onChange={(e) => setF((x) => ({ ...x, phone: e.target.value }))} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn accent" disabled={busy} onClick={() => save('/api/account/profile', f, 'Profile updated.')}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="btn" disabled={busy} onClick={() => setMode('view')}>Cancel</button>
        </div>
      </div>
    );
  }

  if (mode === 'password') {
    return (
      <div>
        {err && <div className="error-box">{err}</div>}
        <div className="form-2col">
          <div className="field"><label>Current password</label><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((x) => ({ ...x, current: e.target.value }))} /></div>
          <div className="field"><label>New password (8+ characters)</label><input type="password" minLength={8} autoComplete="new-password" value={pw.next} onChange={(e) => setPw((x) => ({ ...x, next: e.target.value }))} /></div>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>Changing your password signs you out everywhere else.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn accent" disabled={busy || pw.next.length < 8} onClick={() => save('/api/account/password', pw, 'Password changed.')}>{busy ? 'Saving…' : 'Change password'}</button>
          <button className="btn" disabled={busy} onClick={() => setMode('view')}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {notice && <div className="notice-box">{notice}</div>}
      <div style={{ fontSize: 14.5, display: 'grid', gap: 4 }}>
        <div><b>Name:</b> {profile.name || '—'}</div>
        <div><b>Email:</b> {profile.email}</div>
        <div><b>Phone:</b> {profile.phone || '—'}</div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" onClick={() => { setNotice(''); setMode('edit'); }}>Edit profile</button>
        <button className="btn" onClick={() => { setNotice(''); setMode('password'); }}>Change password</button>
      </div>
    </div>
  );
}
