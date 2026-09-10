'use client';

// Sign out, from the nav. The dispatch coordinator's portal is one page with no
// /account link on it, so without this the only way off a shared warehouse
// browser is clearing cookies.
//
// /logout is NOT a route in this app (the proxy's allow-list names it, but
// nothing serves it) — logging out is a POST to /api/auth/logout, which also
// bumps the user's token_version and kills the session server-side. Land on
// /login rather than /, which on an rssolutions.ca host is the other company.
export default function NavSignOut() {
  async function signOut() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    window.location.href = '/login?next=/admin/dispatch';
  }
  return (
    <button type="button" className="admin-nav-link" onClick={signOut}
      style={{ marginLeft: 'auto', background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}>
      Sign out
    </button>
  );
}
