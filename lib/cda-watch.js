// CDA's workbook, watched instead of remembered.
//
// A LIVE SHEET IS NOT A SHEET THAT ARRIVES. Every other client hands us a
// document — an email, an attachment, a BOL — and the document is the event.
// Canadian Discount Appliances edit one workbook in place, so there is no event
// at all: rows appear on a Tuesday and the only thing that ever surfaced them
// was somebody deciding to go and look. That is the failure this closes, and it
// is why the interesting part here is the DIFF, not the download.
//
// Same rule as every other import: it STAGES. Nothing reaches the board without
// a person approving it.
import crypto from 'crypto';
import { readXlsx } from './xlsx-lite';
import { downloadCdaWorkbook } from './onedrive';
import { getSetting, setSetting } from './settings';
import { stageBatch, ensureImportSchema } from './import-batches';
import { sendEmail } from './email';
import { dispatchDesk } from './constants';

// A row's identity is its own contents, normalised. Not its position: a client
// sorting the sheet by date, or deleting a cancelled line, would otherwise
// renumber everything below it and re-stage the whole workbook as "new".
export function rowKey(row) {
  const norm = (row || [])
    .map((c) => String(c ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
    .join('')
    .replace(/()+$/, '');
  return crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
}

// A row that is blank, or carries nothing but a single stray value, is not work
// — spreadsheets are full of spacer rows and half-typed lines somebody is still
// thinking about. Requiring two populated cells keeps those out without guessing
// at which columns matter, which is the mapper's job and not this one's.
export function isRealRow(row) {
  return (row || []).filter((c) => String(c ?? '').trim()).length >= 2;
}

const seenKey = 'cda_seen_rows';
const MAX_SEEN = 4000;

export async function watchCdaSheet({ dryRun = false, max = 200 } = {}) {
  await ensureImportSchema();

  let buf;
  try {
    buf = await downloadCdaWorkbook();
  } catch (e) {
    // Names the reason — an expired grant, no file chosen, a revoked share —
    // rather than returning nothing, which reads identically to a quiet week.
    return { ok: false, reason: e.message };
  }

  let book;
  try {
    book = readXlsx(buf, (await getSetting('cda_sheet_name', null)) || undefined);
  } catch (e) {
    return { ok: false, reason: `could not read the workbook: ${e.message}` };
  }

  const all = (book.rows || []).filter(isRealRow);
  if (all.length < 2) return { ok: true, sheet: book.sheet, rows: 0, fresh: 0, staged: null, reason: 'the sheet is empty' };

  const [headers, ...body] = all;
  const seen = new Set((await getSetting(seenKey, [])) || []);

  // FIRST RUN IS A BASELINE, NOT AN IMPORT. A sheet with a year of history in it
  // would otherwise stage hundreds of long-delivered rows as new work on the day
  // this is switched on. The rows are remembered and nothing is staged; from the
  // next poll, only genuinely new lines surface.
  const firstRun = seen.size === 0;

  const fresh = [];
  for (const r of body) {
    const k = rowKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    fresh.push(r);
  }

  const remember = async () => {
    // Keep the newest keys. An unbounded setting grows until the row is too big
    // to write, and the oldest lines are the ones that can never come back.
    const keys = [...seen].slice(-MAX_SEEN);
    await setSetting(seenKey, keys);
  };

  if (firstRun) {
    if (!dryRun) await remember();
    return { ok: true, sheet: book.sheet, rows: body.length, fresh: 0, staged: null, baseline: true };
  }
  if (!fresh.length) return { ok: true, sheet: book.sheet, rows: body.length, fresh: 0, staged: null };

  const rows = fresh.slice(0, max);
  if (dryRun) return { ok: true, sheet: book.sheet, rows: body.length, fresh: rows.length, staged: null, dryRun: true, sample: rows.slice(0, 3) };

  const batch = await stageBatch({
    headers,
    rows,
    sourceName: `CDA sheet — ${rows.length} new row${rows.length === 1 ? '' : 's'}`,
    readAs: 'sheet',
    // The client is named by the profile the first approval teaches it
    // (client_sheet_profiles, keyed on this heading row), so it is deliberately
    // not forced here — a wrong client on every row is worse than a question.
    createdBy: { email: 'cda-watch', name: 'CDA sheet watcher' }
  });

  // Remembered only AFTER the batch is safely staged. Remembering first and
  // failing to stage would drop those rows forever, silently — the one outcome
  // worse than staging a duplicate.
  await remember();
  await notifyDesk(rows.length, batch);

  return { ok: true, sheet: book.sheet, rows: body.length, fresh: rows.length, staged: batch?.id ?? null, skipped: Math.max(0, fresh.length - rows.length) };
}

async function notifyDesk(count, batch) {
  try {
    await sendEmail({
      to: dispatchDesk(),
      subject: `[Dispatch] CDA added ${count} row${count === 1 ? '' : 's'} to their sheet`,
      brand: 'rs_solutions',
      html: `<p>Canadian Discount Appliances have added <b>${count}</b> line${count === 1 ? '' : 's'} to the shared workbook.
        They are staged as <b>${batch?.batchNumber || 'a new import'}</b> and are <b>not on the board yet</b>.</p>
        <p>Open the Import tab on dispatch to check them and put them on a day.</p>`
    });
  } catch (e) {
    console.error('cda notify failed', e.message);
  }
}
