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
import { getSetting, setSetting, getSettingStrict } from './settings';
import { stageBatch, ensureImportSchema } from './import-batches';
import { sendEmail } from './email';
import { dispatchDesk } from './constants';

// A row's identity is its own contents, normalised. Not its position: a client
// sorting the sheet by date, or deleting a cancelled line, would otherwise
// renumber everything below it and re-stage the whole workbook as "new".
//
// The cells are joined with a SEPARATOR, which is the part that was missing.
// Joining with '' erased the column boundaries, so ['AB','C'] and ['A','BC']
// hashed identically — and the loser of a collision is taken for a row already
// seen, i.e. silently never staged. The `.replace(/()+$/, '')` that used to sit
// here was a no-op (an empty capture group matches the empty string at the end
// of every input); it is the fingerprint of a separator lost in an edit.
//
// Trailing blank cells are dropped BEFORE joining, which is what that dead
// regex was reaching for and what a separator now makes necessary: readXlsx
// pads every row out to the width of the sheet, so the day the client adds a
// column, every key would otherwise change at once and the entire workbook
// would read as new work.
const SEP = '\u001f';

// The shape of a key. Changing how rowKey works invalidates every key already
// stored, so it is versioned: a mismatch re-baselines instead of staging (see
// watchCdaSheet), because the rows on the sheet today are by definition rows we
// have already been shown.
export const KEY_VERSION = 2;

export function rowKey(row) {
  const cells = (row || []).map((c) => String(c ?? '').trim().toLowerCase().replace(/\s+/g, ' '));
  while (cells.length && !cells[cells.length - 1]) cells.pop();
  return crypto.createHash('sha1').update(cells.join(SEP)).digest('hex').slice(0, 16);
}

// A row that is blank, or carries nothing but a single stray value, is not work
// — spreadsheets are full of spacer rows and half-typed lines somebody is still
// thinking about. Requiring two populated cells keeps those out without guessing
// at which columns matter, which is the mapper's job and not this one's.
export function isRealRow(row) {
  return (row || []).filter((c) => String(c ?? '').trim()).length >= 2;
}

const seenKey = 'cda_seen_rows';
const baselineKey = 'cda_baseline_at';

// Keys are 16 characters; twenty thousand of them is a few hundred KB of jsonb,
// and the point of the headroom is that a workbook carrying years of history
// still fits inside its own memory. Eviction prefers rows that have LEFT the
// sheet — see remember(). The old cap of 4000 evicted by age alone, so a bigger
// workbook forgot rows that were still sitting on it and re-staged them as new.
const MAX_SEEN = 20000;

// What is stored is { v, keys }. A bare array is the original, unversioned
// format and is read as v1.
function readSeen(stored) {
  if (Array.isArray(stored)) return { v: 1, keys: stored };
  return { v: Number(stored?.v) || 0, keys: Array.isArray(stored?.keys) ? stored.keys : [] };
}

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

  // READ STRICTLY. getSetting hands back its fallback on a database error, and
  // the fallback here means "nothing remembered" — indistinguishable from a
  // genuine first run, so one bad moment would re-baseline the watcher and
  // swallow everything the client had added since the last poll. A blip has to
  // look like a blip and leave the memory alone.
  let stored;
  let baselineAt;
  try {
    [stored, baselineAt] = await Promise.all([
      getSettingStrict(seenKey, null),
      getSettingStrict(baselineKey, null)
    ]);
  } catch (e) {
    return { ok: false, reason: `could not read what has already been seen: ${e.message}` };
  }

  const prior = readSeen(stored);
  // Every stored key was made by a different algorithm and means nothing now.
  const rekey = prior.v !== KEY_VERSION;
  const priorKeys = rekey ? [] : prior.keys;
  const firstRun = !baselineAt;

  const all = (book.rows || []).filter(isRealRow);
  const [headers, ...body] = all.length ? all : [[]];
  const bodyKeys = body.map(rowKey);
  const onSheet = new Set(bodyKeys);

  // Remember the keys we are GIVEN, on top of what was already known. Eviction
  // only ever takes rows that are no longer on the sheet: forgetting a row that
  // is still there brings it back as new work on the next poll.
  const remember = async (addKeys) => {
    const keep = [...priorKeys, ...addKeys];
    const live = keep.filter((k) => onSheet.has(k));
    const gone = keep.filter((k) => !onSheet.has(k));
    const room = Math.max(0, MAX_SEEN - live.length);
    await setSetting(seenKey, { v: KEY_VERSION, keys: [...live.slice(-MAX_SEEN), ...gone.slice(-room)] });
  };

  const markBaseline = async (keys) => {
    await setSetting(baselineKey, baselineAt || new Date().toISOString());
    await remember(keys);
  };

  if (all.length < 2) {
    // An empty sheet has still been LOOKED AT. Without recording that, the next
    // poll reads as a first run and the first real lines the client types get
    // baselined away instead of staged.
    if (!dryRun && (firstRun || rekey)) await markBaseline([]);
    return { ok: true, sheet: book.sheet, rows: 0, fresh: 0, stagedCount: 0, staged: null, skipped: 0, reason: 'the sheet is empty' };
  }

  // FIRST RUN IS A BASELINE, NOT AN IMPORT. A sheet with a year of history in it
  // would otherwise stage hundreds of long-delivered rows as new work on the day
  // this is switched on. The rows are remembered and nothing is staged; from the
  // next poll, only genuinely new lines surface. A rowKey version change lands
  // here for the same reason — the sheet's current contents are not new work.
  if (firstRun || rekey) {
    if (!dryRun) await markBaseline(bodyKeys);
    return {
      ok: true, sheet: book.sheet, rows: body.length, fresh: 0, stagedCount: 0, staged: null,
      skipped: 0, baseline: true, rekeyed: rekey && !firstRun
    };
  }

  const known = new Set(priorKeys);
  const fresh = [];
  body.forEach((row, i) => {
    const key = bodyKeys[i];
    if (known.has(key)) return;
    known.add(key);              // two identical lines in one sheet are one row
    fresh.push({ row, key });
  });

  if (!fresh.length) return { ok: true, sheet: book.sheet, rows: body.length, fresh: 0, stagedCount: 0, staged: null, skipped: 0 };

  const take = fresh.slice(0, max);
  const skipped = fresh.length - take.length;
  if (dryRun) {
    return {
      ok: true, sheet: book.sheet, rows: body.length, fresh: fresh.length, stagedCount: 0,
      staged: null, skipped, dryRun: true, sample: take.slice(0, 3).map((f) => f.row)
    };
  }

  const batch = await stageBatch({
    headers,
    rows: take.map((f) => f.row),
    sourceName: `CDA sheet — ${take.length} new row${take.length === 1 ? '' : 's'}`,
    readAs: 'sheet',
    // The client is named by the profile the first approval teaches it
    // (client_sheet_profiles, keyed on this heading row), so it is deliberately
    // not forced here — a wrong client on every row is worse than a question.
    createdBy: { email: 'cda-watch', name: 'CDA sheet watcher' }
  });

  // ONLY WHAT WAS ACTUALLY STAGED IS REMEMBERED, and only after the batch is
  // safely written. Everything past `max` stays unknown and comes back on the
  // next poll. Marking the overflow as seen — which is what adding keys during
  // the diff did — retired rows nobody had ever been shown: at 250 new lines,
  // fifty of them vanished for good, and no screen or email said a word,
  // because both report the number STAGED.
  await remember(take.map((f) => f.key));
  await notifyDesk(take.length, batch, skipped);

  return {
    ok: true, sheet: book.sheet, rows: body.length,
    fresh: fresh.length, stagedCount: take.length, skipped,
    staged: batch?.id ?? null, batchNumber: batch?.batchNumber ?? null,
    // A workbook bigger than the memory itself cannot be tracked reliably; say
    // so rather than quietly re-staging its oldest rows every poll.
    warning: body.length > MAX_SEEN ? `the sheet has ${body.length} rows, past the ${MAX_SEEN} this can remember` : null
  };
}

async function notifyDesk(count, batch, skipped = 0) {
  try {
    await sendEmail({
      to: dispatchDesk(),
      subject: `[Dispatch] CDA added ${count} row${count === 1 ? '' : 's'} to their sheet`,
      brand: 'rs_solutions',
      html: `<p>Canadian Discount Appliances have added <b>${count}</b> line${count === 1 ? '' : 's'} to the shared workbook.
        They are staged as <b>${batch?.batchNumber || 'a new import'}</b> and are <b>not on the board yet</b>.</p>
        <p>Open the Import tab on dispatch to check them and put them on a day.</p>
        ${skipped ? `<p><b>${skipped} further new line${skipped === 1 ? '' : 's'}</b> did not fit this batch and will be staged on the next run — nothing has been lost.</p>` : ''}`
    });
  } catch (e) {
    console.error('cda notify failed', e.message);
  }
}
