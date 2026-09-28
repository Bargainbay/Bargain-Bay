import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// Suppliers got its own page. This route existed for less than a day and is
// kept as a redirect so a link out of the reports hub, or a bookmark, still
// lands somewhere — the same courtesy /admin/dispatch/tickets gets.
export default function SupplierReportRedirect() {
  redirect('/admin/suppliers');
}
