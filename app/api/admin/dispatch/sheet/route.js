import { NextResponse } from 'next/server';
import { getSession, isStaff } from '../../../../../lib/auth';
import { readXlsx } from '../../../../../lib/xlsx-lite';
import { extractStopsFromPdf } from '../../../../../lib/pdf-stops';
import { stageBatch, openQuestions } from '../../../../../lib/import-batches';
import { hasDb } from '../../../../../lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// An .xlsx, read into a grid. Server-side because an xlsx is a ZIP and Node
// already has the inflate — the browser would need a library shipped to every
// admin page to do the same job.
//
// **It never creates a stop.** A spreadsheet that puts jobs on the board by
// being uploaded is a spreadsheet nobody checked. What it does now is STAGE the
// rows as a draft batch (`lib/import-batches.js`) — which is not a stop, cannot
// be driven to, and still has to be approved. Staging on upload is what lets
// the review happen somewhere other than this tab: the batch has an id the
// moment the file lands, so a phone call can be reading row 4 while the person
// who uploaded it has already walked away.
const MAX = 6 * 1024 * 1024;

// Rows in, staged batch out — the same tail for a workbook, a PDF and a photo,
// so there is one place that decides what happens to a sheet after it's read.
async function stage(rows, meta, session) {
  const [headers, ...rest] = rows;
  if (!hasDb()) return { rows, batch: null, questions: [] };
  try {
    const batch = await stageBatch({
      headers: headers || [], rows: rest,
      sourceName: meta.name, readAs: meta.read,
      createdBy: { email: session?.email, name: session?.name }
    });
    return { rows, batch, questions: openQuestions(batch) };
  } catch (e) {
    // A sheet that was read fine but couldn't be staged is still a sheet the
    // dispatcher can work with — hand the rows over and say why the rest is
    // missing, rather than failing an upload that actually succeeded.
    return { rows, batch: null, questions: [], stageError: e?.message || 'Could not stage that import.' };
  }
}

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
    const name = String(file.name || '');
    const type = String(file.type || '');

    // A PDF or a photo of a paper sheet is a LAYOUT, not a table — it goes to
    // the reader in lib/pdf-stops, which hands back the same rows a spreadsheet
    // would, so the preview and the confirm step are identical either way.
    if (/\.pdf$/i.test(name) || type.includes('pdf') || type.startsWith('image/')) {
      const out = await extractStopsFromPdf({
        base64: buf.toString('base64'),
        mediaType: type || (/\.pdf$/i.test(name) ? 'application/pdf' : 'image/jpeg')
      });
      if (!out.rows.length) return NextResponse.json({ error: 'No delivery stops found in that document.' }, { status: 400 });
      const staged = await stage([out.headers, ...out.rows].slice(0, 1000), { name: name || 'document.pdf', read: 'ai' }, s);
      return NextResponse.json({
        ok: true, read: 'ai', name: name || 'document.pdf',
        sheets: [], sheet: null,
        sender: out.sender, warning: out.warning, ...staged
      });
    }

    const { sheets, sheet, rows } = readXlsx(buf, String(form.get('sheet') || '') || undefined);
    if (!rows.length) return NextResponse.json({ error: 'That sheet is empty.' }, { status: 400 });
    // 1000 rows is far past a delivery day and stops a stray export from
    // freezing the browser it lands in.
    const staged = await stage(rows.slice(0, 1000), { name: file.name || 'sheet.xlsx', read: 'sheet' }, s);
    return NextResponse.json({ ok: true, read: 'sheet', sheets, sheet, name: file.name || 'sheet.xlsx', ...staged });
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Could not read that file.' }, { status: 400 });
  }
}
