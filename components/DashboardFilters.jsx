'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

// Period selector for the revenue dashboard. Drives the URL (?period=…) so the
// server page re-renders with the chosen window; shows a pending state while the
// new data loads.
export default function DashboardFilters({ periods, active }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const pick = (key) => {
    if (key === active) return;
    startTransition(() => router.push(`/admin/dashboard?period=${key}`));
  };

  return (
    <div className="dash-filters" role="group" aria-label="Time period">
      {periods.map((p) => (
        <button
          key={p.key}
          type="button"
          className={'dash-filter' + (p.key === active ? ' active' : '')}
          aria-pressed={p.key === active}
          disabled={pending}
          onClick={() => pick(p.key)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
