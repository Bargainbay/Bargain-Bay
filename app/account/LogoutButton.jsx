'use client';

export default function LogoutButton() {
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }
  return <button className="btn" onClick={logout}>Log out</button>;
}
