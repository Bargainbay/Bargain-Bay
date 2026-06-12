import { Suspense } from 'react';
import LoginForm from './LoginForm';

export const metadata = { title: 'Login — Bargain Bay' };

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="narrow"><p>Loading…</p></div>}>
      <LoginForm />
    </Suspense>
  );
}
