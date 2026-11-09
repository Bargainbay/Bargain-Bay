import { redirect } from 'next/navigation';

// Team clock is part of Payroll now (one tab). This keeps any saved link working.
export default async function TeamClockMoved({ searchParams }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp?.from) qs.set('from', String(sp.from));
  if (sp?.to) qs.set('to', String(sp.to));
  redirect(`/admin/payroll${qs.toString() ? `?${qs}` : ''}`);
}
