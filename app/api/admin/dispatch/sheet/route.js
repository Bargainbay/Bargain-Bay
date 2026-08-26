import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../../lib/auth';
import { readXlsx } from '../../../../../lib/xlsx-lite';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// An .xlsx, read into a grid. Server-side because an xlsx is a ZIP and Node
// already has the inflate — the browser would need a library shipped to every
// admin page to do the same job.
//
// It only READS. Nothing here writes a job: the rows go back to the importer,
// which shows them for confirmation like any pasted table. A spreadsheet that
// creates stops by being uploaded is a spreadsheet nobody checked.
const MAX = 6 * 1024 * 1024;

export async function POST(req) {
  const s = await getSession();
  if (!s || !isStaff(s)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  let form;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 }); }
  const file = form.get('file');
  if (!file || typeof file !== 'object') return NextResponse.json({ error: 'No file.' }, { status: 400 });
  if (file.size > MAX) {
    return NextResponse.json({ error: 'That file is over 6MB — export just the delivery rows.' }, { status: 413 });
  }

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const { sheets, sheet, rows } = readXlsx(buf, String(form.get('sheet') || '') || undefined);
    if (!rows.length) return NextResponse.json({ error: 'That sheet is empty.' }, { status: 400 });
    // 1000 rows is far past a delivery day and stops a stray export from
    // freezing the browser it lands in.
    return NextResponse.json({ ok: true, sheets, sheet, rows: rows.slice(0, 1000), name: file.name || 'sheet.xlsx' });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not read that file.' }, { status: 400 });
  }
}
