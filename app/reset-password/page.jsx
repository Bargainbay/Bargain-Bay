import { Suspense } from 'react';
import ResetForm from './ResetForm';

export const metadata = { title: 'Choose a new password — Bargain Bay' };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="narrow"><p>Loading…</p></div>}>
      <ResetForm />
    </Suspense>
  );
}
