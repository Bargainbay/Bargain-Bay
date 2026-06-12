import { Suspense } from 'react';
import TrackForm from './TrackForm';

export const metadata = { title: 'Track Your Order — Bargain Bay' };

export default function TrackPage() {
  return (
    <Suspense fallback={<div className="narrow"><p>Loading…</p></div>}>
      <TrackForm />
    </Suspense>
  );
}
