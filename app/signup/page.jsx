import { Suspense } from 'react';
import SignupForm from './SignupForm';

export const metadata = { title: 'Create Account — Bargain Bay' };

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="narrow"><p>Loading…</p></div>}>
      <SignupForm />
    </Suspense>
  );
}
