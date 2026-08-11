// GET /invoice/[number]/pdf — download the invoice as a PDF file. Same access
// gate as the hosted invoice page (admin session, owner session, signed ?t=
// token, or matching ?email=); anyone who can see the page can download it.
import { hasDb } from '../../../../lib/db';
import { getInvoiceByNumber } from '../../../../lib/invoices';
import { getSession, isAdmin } from '../../../../lib/auth';
import { verifyLinkToken } from '../../../../lib/links';
import { invoicePdf } from '../../../../lib/pdf-docs';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { number } = await params;
  if (!hasDb()) return new Response('Invoices are not available.', { status: 503 });
  const invoice = await getInvoiceByNumber(number).catch(() => null);
  if (!invoice) return new Response('Not found.', { status: 404 });

  const url = new URL(request.url);
  const guestEmail = String(url.searchParams.get('email') || '').trim().toLowerCase();
  const session = await getSession();
  const owns =
    (session && isAdmin(session)) ||
    (session && session.email?.toLowerCase() === invoice.email?.toLowerCase()) ||
    verifyLinkToken('invoice', invoice.number, url.searchParams.get('t')) ||
    (guestEmail && guestEmail === invoice.email?.toLowerCase());
  if (!owns) return new Response('Not authorized — open the link from your invoice email.', { status: 403 });

  return new Response(invoicePdf(invoice), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Bargain-Bay-${invoice.number}.pdf"`,
      'Cache-Control': 'no-store'
    }
  });
}
