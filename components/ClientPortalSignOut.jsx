'use client';
import { useRouter } from 'next/navigation';

export default function ClientPortalSignOut({ clientId, token }) {
  const router = useRouter();
  return (
    <button type="button" className="btn" onClick={async () => {
      await fetch('/api/client/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ c: clientId, t: token, logout: true }) });
      router.refresh();
    }}>Sign out</button>
  );
}
