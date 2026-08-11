// GET /order/[orderNumber]/pdf — download the order receipt as a PDF file.
// Same access gate as the order status page (owner session, signed ?t= token,
// or matching ?email=); anyone who can see the page can download it.
import { hasDb } from '../../../../lib/db';
import { getOrderByNumber } from '../../../../lib/orders';
import { getSession } from '../../../../lib/auth';
import { verifyLinkToken } from '../../../../lib/links';
import { orderPdf } from '../../../../lib/pdf-docs';

export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const { orderNumber } = await params;
  if (!hasDb()) return new Response('Order tracking is not available.', { status: 503 });
  const order = await getOrderByNumber(orderNumber).catch(() => null);
  if (!order) return new Response('Not found.', { status: 404 });

  const url = new URL(request.url);
  const guestEmail = String(url.searchParams.get('email') || '').trim().toLowerCase();
  const session = await getSession();
  const owns =
    (session && order.user_id && session.userId === order.user_id) ||
    (session && session.email?.toLowerCase() === order.email?.toLowerCase()) ||
    verifyLinkToken('order', order.order_number, url.searchParams.get('t')) ||
    (guestEmail && guestEmail === order.email?.toLowerCase());
  if (!owns) return new Response('Not authorized — open the link from your confirmation email.', { status: 403 });

  return new Response(orderPdf(order), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Bargain-Bay-${order.order_number}.pdf"`,
      'Cache-Control': 'no-store'
    }
  });
}
