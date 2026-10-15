// The blank spreadsheet: every column, plus one worked example row to delete.
import { NextResponse } from 'next/server';
import { requireVendor } from '../../../../../../lib/vendor-session';
import { bulkTemplateCsv } from '../../../../../../lib/listing-bulk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const ctx = await requireVendor('listings.bulk');
  if (!ctx) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  return new NextResponse(bulkTemplateCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bargain-bay-listings-template.csv"',
      'Cache-Control': 'no-store'
    }
  });
}
