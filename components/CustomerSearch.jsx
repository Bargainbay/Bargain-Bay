'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// Search box for the client database — URL-driven (?q=) like the period
// filters, so the server component does the actual filtering and the URL is
// shareable. Debounced so we don't re-render the page on every keystroke.
export default function CustomerSearch({ initial = '' }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(initial);
  const t = useRef(null);

  useEffect(() => () => clearTimeout(t.current), []);

  function onChange(e) {
    const value = e.target.value;
    setQ(value);
    clearTimeout(t.current);
    t.current = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set('q', value.trim()); else next.delete('q');
      router.replace(`/admin/customers?${next.toString()}`, { scroll: false });
    }, 350);
  }

  return (
    <input
      value={q}
      onChange={onChange}
      placeholder="Search customers by name, email, or phone…"
      style={{ maxWidth: 380 }}
      aria-label="Search customers"
    />
  );
}
