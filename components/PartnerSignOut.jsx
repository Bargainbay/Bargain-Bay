'use client';
export default function PartnerSignOut() {
  async function signOut() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login?next=/partner';
  }
  return <button type="button" className="btn" onClick={signOut}>Sign out</button>;
}
