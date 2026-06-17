import { redirect } from 'next/navigation';

// The owner portal's home base is the dashboard; /admin just lands there.
export const dynamic = 'force-dynamic';

export default function AdminIndex() {
  redirect('/admin/dashboard');
}
