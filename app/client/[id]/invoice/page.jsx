import { notFound } from 'next/navigation';
import { brandFor } from '../../../../lib/brands';
import RsInvoiceDocument from '../../../../components/RsInvoiceDocument';
import { DEMO_JOBS } from '../../../../lib/client-portal-demo';
import { jobLineDescription } from '../../../../lib/invoice-job-line';

export const metadata = { title: { absolute: 'Invoice preview — RS Solutions' }, robots: { index: false, follow: false } };

// What a client's invoice looks like, with sample stops. Preview only: the real
// invoice lives at /invoice/<number> and reads the stops it billed.
export default async function InvoicePreview({ params }) {
  const { id } = await params;
  if (id !== 'demo') notFound();
  const B = brandFor('rs_solutions');
  const billed = DEMO_JOBS.filter((j) => j.invoiceNumber);
  const prices = { 8: 85, 7: 125 };
  const rows = billed.map((j) => ({
    id: j.id, amount: prices[j.id] || 85,
    lines: jobLineDescription({ ref: j.orderNumber, customer: j.customerName, services: j.services }).split('\n'),
    href: `/client/demo/job/${j.id}`
  }));
  const subtotal = rows.reduce((a, r) => a + r.amount, 0);
  const hst = Math.round(subtotal * 13) / 100;
  const invoice = {
    number: 'INV-DEMO', name: 'Canadian Discount Appliances', address: '808 Courtland Ave, Kitchener', phone: '(519) 658-3409', email: 'Matt@grahams.ca',
    created_at: '2026-10-26T16:00:00Z', due_date: '2026-11-09', subtotal, hst, total: subtotal + hst, memo: 'Attn: Matt Graham. Services 2026-10-26 to 2026-10-26.'
  };
  return (
    <RsInvoiceDocument invoice={invoice} B={B} rows={rows} portalHref="/client/demo" pdfHref="#"
      statusLabel="Open" paid={false} open partial={false} amountPaid={0} balance={0} />
  );
}
