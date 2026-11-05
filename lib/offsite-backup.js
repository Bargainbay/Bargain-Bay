// Off-site copies of the two stores nothing else backs up (docs/BACKUP.md).
//
//   · the master tracker — copied whole into a Drive folder, once a day.
//   · Vercel Blob — proof-of-delivery signatures and photos, unit photos, fuel
//     receipts. Postgres holds only their PATHS, so a database restore alone
//     gives rows pointing at pictures that are gone. New objects are copied to
//     the same Drive folder; `offsite_backup_blobs` remembers what is done, so
//     each hourly pass uploads only what is new and a first run catches up over
//     a few passes rather than trying to do everything inside one function.
//
// DORMANT WITHOUT `BACKUP_DRIVE_FOLDER_ID`, like every integration here. It uses
// the Google service account the tracker sync already holds, so the only setup
// is a Drive folder shared with that account as Editor.
//
// It only ever ADDS. Nothing here deletes from Drive or from Blob: a backup job
// that can delete is one bug away from being the thing that lost the data.
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { list, get } from '@vercel/blob';
import { query, hasDb } from './db';
import { isProduction } from './environment';

const FOLDER = () => (process.env.BACKUP_DRIVE_FOLDER_ID || '').trim();
const TRACKER_ID = () => process.env.DRIVE_FILE_ID || process.env.SHEET_ID || process.env.GOOGLE_SHEETS_ID;
// Every outside call is capped and NAMED. A Drive or Blob call that never answers
// used to hang the whole pass until the platform killed it at the route limit,
// which records no reason at all: the hourly job "failed" 625 times and said
// nothing. Now the pass fails fast and says which step stalled.
export function withTimeout(label, ms, promise) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} did not answer within ${Math.round(ms / 1000)}s`)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}
const BLOB_BUDGET_MS = 30_000;   // stay well inside the route's time limit
const MAX_BLOB_BYTES = 40 * 1024 * 1024;

export function offsiteConfigured() {
  return !!(FOLDER() && (process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON));
}

function driveClient() {
  const raw = process.env.GOOGLE_CREDENTIALS || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const creds = JSON.parse(raw.trim());
  const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/drive'] });
  return google.drive({ version: 'v3', auth });
}

// Drive filenames are flat; Blob pathnames are not.
export const flatName = (pathname, uploadedAt) =>
  `${Math.floor(new Date(uploadedAt).getTime() / 1000)}__${String(pathname).replace(/[\\/]+/g, '__')}`;

// What of `blobs` is not yet recorded. Keyed on pathname AND upload time, so an
// object overwritten under the same name is backed up again rather than skipped.
export function newBlobs(blobs, done) {
  const have = new Set(done.map((d) => `${d.pathname}|${new Date(d.uploaded_at).getTime()}`));
  return blobs.filter((b) => !have.has(`${b.pathname}|${new Date(b.uploadedAt).getTime()}`));
}

async function subfolder(drive, name) {
  const q = `'${FOLDER()}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found = await drive.files.list({ q, fields: 'files(id)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true });
  if (found.data.files?.length) return found.data.files[0].id;
  const made = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [FOLDER()] },
    fields: 'id', supportsAllDrives: true
  });
  return made.data.id;
}

// Daily copy of the tracker. Re-running on the same day does nothing.
export async function backupTracker(drive, now = new Date()) {
  const id = TRACKER_ID();
  if (!id) return { skipped: 'no tracker file id' };
  const day = now.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const name = `tracker-${day}`;
  const dir = await subfolder(drive, 'tracker');
  const existing = await drive.files.list({
    q: `'${dir}' in parents and name = '${name}' and trashed = false`,
    fields: 'files(id)', pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  if (existing.data.files?.length) return { already: name };
  const copy = await drive.files.copy({
    fileId: id, requestBody: { name, parents: [dir] }, fields: 'id,size', supportsAllDrives: true
  });
  return { copied: name, id: copy.data.id };
}

export async function backupBlobs(drive, { budgetMs = BLOB_BUDGET_MS } = {}) {
  const started = Date.now();
  const dir = await subfolder(drive, 'blobs');
  let cursor; const all = [];
  do {
    const page = await withTimeout('listing Blob files', 15_000, list({ cursor, limit: 1000 }));
    all.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const { rows: done } = await query('SELECT pathname, uploaded_at FROM offsite_backup_blobs');
  const todo = newBlobs(all, done);
  const out = { total: all.length, pending: todo.length, copied: 0, failed: 0, skippedLarge: 0, errors: [] };

  for (const b of todo) {
    if (Date.now() - started > budgetMs) break;
    if (b.size > MAX_BLOB_BYTES) { out.skippedLarge++; continue; }
    try {
      const res = await withTimeout(`reading ${b.pathname} from Blob`, 15_000, get(b.pathname, { access: 'private' }));
      if (!res || res.statusCode !== 200 || !res.stream) throw new Error('could not read from Blob');
      const file = await withTimeout(`uploading ${b.pathname} to Drive`, 20_000, drive.files.create({
        requestBody: { name: flatName(b.pathname, b.uploadedAt), parents: [dir], appProperties: { pathname: b.pathname } },
        media: { mimeType: res.blob?.contentType || 'application/octet-stream', body: Readable.fromWeb(res.stream) },
        fields: 'id', supportsAllDrives: true
      }));
      await query(
        `INSERT INTO offsite_backup_blobs (pathname, uploaded_at, size_bytes, drive_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [b.pathname, new Date(b.uploadedAt).toISOString(), b.size, file.data.id]
      );
      out.copied++;
    } catch (e) {
      out.failed++;
      if (out.errors.length < 5) out.errors.push(`${b.pathname}: ${e?.message || e}`);
    }
  }
  out.pending = todo.length - out.copied - out.skippedLarge;
  return out;
}

// One sentence for why a pass failed. The route used to answer 500 with the
// reasons nested under `tracker` / `blobs` and no top-level `error`, so the
// heartbeat stored nothing and "has run 625x and never succeeded" came with no
// cause attached. Google's "Service Accounts do not have storage quota" lands
// here too: a service account cannot own files in a person's My Drive, only in
// a shared drive.
export function summariseBackupFailure(r) {
  const parts = [];
  if (r?.error) parts.push(r.error);
  if (r?.tracker?.error) parts.push(`tracker copy: ${r.tracker.error}`);
  if (r?.blobs?.error) parts.push(`file copy: ${r.blobs.error}`);
  if (r?.blobs?.failed) parts.push(`${r.blobs.failed} file(s) failed${r.blobs.errors?.[0] ? ` (e.g. ${r.blobs.errors[0]})` : ''}`);
  return parts.join('; ').slice(0, 280) || 'unknown failure';
}

export async function runOffsiteBackup() {
  if (!offsiteConfigured()) return { ok: true, dormant: true, note: 'BACKUP_DRIVE_FOLDER_ID is not set' };
  if (!isProduction()) return { ok: true, dormant: true, note: 'only production backs up' };
  if (!hasDb()) return { ok: false, error: 'no database' };
  const drive = driveClient();
  const tracker = await withTimeout('copying the tracker to Drive', 20_000, backupTracker(drive)).catch((e) => ({ error: e?.message || String(e) }));
  const blobs = await withTimeout('copying files to Drive', 32_000, backupBlobs(drive)).catch((e) => ({ error: e?.message || String(e) }));
  const ok = !tracker.error && !blobs.error && !blobs.failed;
  return { ok, tracker, blobs };
}

// For the health email: how stale is each half?
export async function offsiteStatus() {
  try {
    const { rows } = await query(
      `SELECT count(*)::int AS copied, max(backed_up_at) AS last_blob FROM offsite_backup_blobs`);
    return rows[0];
  } catch { return null; }
}
