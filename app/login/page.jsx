import { Suspense } from 'react';
import LoginForm from './LoginForm';
import { oauthProviders } from '../../lib/oauth';

export const metadata = { title: 'Login — Bargain Bay' };
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="narrow"><p>Loading…</p></div>}>
      <LoginForm providers={oauthProviders()} />
    </Suspense>
  );
}
