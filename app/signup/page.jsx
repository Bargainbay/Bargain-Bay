import { Suspense } from 'react';
import SignupForm from './SignupForm';
import { oauthProviders } from '../../lib/oauth';

export const metadata = { title: 'Create Account — Bargain Bay' };

export const dynamic = 'force-dynamic';

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="narrow"><p>Loading…</p></div>}>
      <SignupForm providers={oauthProviders()} />
    </Suspense>
  );
}
