import { redirect } from 'next/navigation';

// The Reports tab was folded into the Dashboard (period filters + comparisons,
// pipeline, trend chart, what's-selling, realized margin, salvage revenue all
// live there now). Keep this route as a permanent redirect for old bookmarks.
export const dynamic = 'force-dynamic';

export default function ReportsPage() {
  redirect('/admin/dashboard');
}
