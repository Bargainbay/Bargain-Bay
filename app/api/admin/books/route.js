// A records section as a CSV download. Open to admins and granted accountants —
// downloading the books is the accountant's whole reason for being here.
import { getSession, canKeepBooks } from '../../../../lib/auth';
import { sectionCsv, BOOK_SECTIONS, BOOK_PERIODS } from '../../../../lib/books';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const s = await getSession();
  if (!(await canKeepBooks(s))) return new Response('Not authorized', { status: 403 });
  const sp = new URL(req.url).searchParams;
  const section = BOOK_SECTIONS[sp.get('section')] ? sp.get('section') : null;
  if (!section) return new Response('Unknown section.', { status: 400 });
  const period = BOOK_PERIODS.some((p) => p.key === sp.get('period')) ? sp.get('period') : 'month';
  const { name, csv } = await sectionCsv(section, period);
  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` }
  });
}
