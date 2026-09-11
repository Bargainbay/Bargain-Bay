// Freightcom pickup notifications, staged without anybody typing them.
//
// THE JOB THIS DOES. Parallel Supply Chain forwards a Freightcom "Pick Up
// Notification" and says, in prose: *RS please pick this up and bring it to
// SecondShop.* The stop was then only ever real if somebody read the mail,
// opened the BOL, and typed it onto the board. Three of them went missing on
// 2026-09-10 — confirmed to the client by reply, and on nobody's board.
//
// THE LINE THIS DOES NOT CROSS. It stages; it never boards. Same rule as every
// other import here: a batch sits on the Import tab until a person approves it.
// An address read out of a PDF by a model is a guess until somebody agrees with
// it, and a wrong one is a van at the wrong door.
//
// WHERE THESE ACTUALLY GO (owner, 2026-09-10). The BOL's consignee IS our drop:
// an Ontario delivery is driven to the address on the BOL. The ONE exception is a
// Quebec-bound load — pickup only, dropped at the Burlington cross-dock — and
// that rule already exists as `quebecRule` in lib/stop-import.js, on by default
// for every staged batch. So this file deliberately does NOT rewrite addresses.
// An earlier draft redirected every row to SecondShop's warehouse on the strength
// of the covering email's prose; that would have been wrong for every Ontario
// stop, which is most of them.
import { gmailConfigured, listAttachmentEmails, getAttachment, readEmail } from './gmail';
import { extractStopsFromPdf, PDF_COLUMNS } from './pdf-stops';
import { stageBatch, alreadyStaged, ensureImportSchema } from './import-batches';
import { sendEmail } from './email';
import { dispatchDesk } from './constants';

// Which mailbox to read. Service@ — the mailbox this mail actually ARRIVES in,
// forwarded from the gmail the clients write to.
//
// NOT the delivery desk, which was the first answer and was wrong: dispatch@ only
// has what the Gmail filter has forwarded since the filter was created, so it is
// missing every notification older than that and would be starved silently the
// day anybody edits the filter. The watcher should read the stream, not a copy of
// the stream. FREIGHTCOM_INBOX overrides.
const WATCH_INBOX = () => process.env.FREIGHTCOM_INBOX || process.env.SERVICE_INBOX || 'service@rssolutions.ca';

// Only the carrier's own notifications, only with something to read. The thread
// then fills with replies ("BOL printed") that carry the SAME subject and the
// SAME forwarded attachment — `from:` is what keeps those out, and the BOL
// number is what catches any that slip through.
const QUERY = 'from:parallelsupplychain.com subject:"Freightcom Pick Up Notification" '
  + 'has:attachment filename:pdf newer_than:14d';

// BOL#: PSC10392 — the identity of the shipment, and the one value that is
// stable across every copy of it. Deduping on the Gmail message id alone is not
// enough: the same BOL arrives again when anyone replies-all with the PDF.
const BOL_RE = /BOL\s*#?\s*:?\s*([A-Z]{2,4}\s*-?\s*\d{4,})/i;
const SERVICE_RE = /Service:\s*([^\n\r]+)/i;
const SHIPDATE_RE = /Shipment Date:\s*([A-Za-z]{3}\s+\d{1,2},\s*\d{4})/i;

export function bolNumber(text) {
  const m = BOL_RE.exec(String(text || ''));
  return m ? m[1].replace(/[\s-]/g, '').toUpperCase() : null;
}

export async function watchFreightcom({ max = 15, dryRun = false } = {}) {
  if (!gmailConfigured()) return { ok: false, reason: 'gmail not configured (GOOGLE_CREDENTIALS / SARAH_EMAIL_INBOXES)' };
  await ensureImportSchema();

  const inbox = WATCH_INBOX();
  let emails = [];
  try {
    ({ emails } = await listAttachmentEmails(inbox, { query: QUERY, max }));
  } catch (e) {
    // The commonest cause by far is the mailbox not being on SARAH_EMAIL_INBOXES,
    // or domain-wide delegation not covering this domain. Say which, rather than
    // letting a silent empty result look like a quiet day.
    console.error('freightcom list failed', e.message);
    return { ok: false, reason: `could not read ${inbox}: ${e.message}` };
  }

  const staged = [], skipped = [], failed = [];

  for (const em of emails) {
    let bol = null;
    try {
      // The BOL number lives in the BODY (the Freightcom block), not the subject.
      const full = await readEmail(inbox, em.id);
      bol = bolNumber(full.body) || bolNumber(em.subject);
      const key = bol ? `bol:${bol}` : `msg:${em.id}`;

      if (await alreadyStaged(key)) { skipped.push({ bol, subject: em.subject, why: 'already staged' }); continue; }

      const pdf = em.attachments.find((a) => (a.mimeType || '').includes('pdf'));
      if (!pdf) { skipped.push({ bol, subject: em.subject, why: 'no PDF on it' }); continue; }

      const { base64 } = await getAttachment(inbox, em.id, pdf.attachmentId);
      const read = await extractStopsFromPdf({ base64, mediaType: pdf.mimeType });
      if (!read.stops?.length) { failed.push({ bol, subject: em.subject, why: 'nothing readable in the BOL' }); continue; }

      // Rows go in AS READ. The only change is the note: the BOL number and the
      // service level are in the covering email, not the PDF, and both matter to
      // whoever drives it — "Delivery to Threshold" is the difference between
      // leaving it at the door and carrying it in.
      const service = (SERVICE_RE.exec(full.body) || [])[1] || '';
      const noteIdx = PDF_COLUMNS.indexOf('Notes');
      const rows = read.stops.map((r) => {
        const row = [...r];
        row[noteIdx] = [bol ? `BOL ${bol}` : '', service, String(row[noteIdx] ?? '').trim()]
          .filter(Boolean).join(' · ');
        return row;
      });

      if (dryRun) { staged.push({ bol, subject: em.subject, rows: rows.length, dryRun: true }); continue; }

      const batch = await stageBatch({
        headers: PDF_COLUMNS,
        rows,
        sourceName: `Freightcom ${bol || em.subject}`.slice(0, 200),
        readAs: 'ai',
        sourceMsgId: key,
        // Deliberately no jobDate. The shipment date on the notification is when
        // the CARRIER wanted it moved, which is routinely not the day RS runs it
        // — on the three that prompted this, the reply said "tomorrow". Left
        // open, it becomes the batch's first question instead of a wrong answer
        // nobody looks at twice.
        createdBy: { email: 'freightcom-watch', name: 'Freightcom watcher' }
      });
      staged.push({ bol, subject: em.subject, rows: rows.length, batchId: batch?.id ?? null });
    } catch (e) {
      console.error('freightcom stage failed', em.id, e.message);
      failed.push({ bol, subject: em.subject, why: e.message });
    }
  }

  if (staged.length && !dryRun) await notifyDesk(staged);
  return { ok: true, inbox, scanned: emails.length, staged, skipped, failed };
}

// Tell the desk there is something to review. Best-effort and last: a mail
// hiccup must never undo work that is already staged and safe.
async function notifyDesk(staged) {
  try {
    const lines = staged.map((s) => `<li>${s.bol || s.subject} — ${s.rows} stop${s.rows === 1 ? '' : 's'}</li>`).join('');
    await sendEmail({
      to: dispatchDesk(),
      subject: `[Dispatch] ${staged.length} Freightcom pickup${staged.length === 1 ? '' : 's'} waiting for review`,
      brand: 'rs_solutions',
      html: `<p>These came in from Parallel and have been read and staged. <b>They are not on the board yet.</b></p>
        <ul>${lines}</ul>
        <p>Open the Import tab on dispatch to check them and put them on a day. A Quebec-bound
        one is turned into a pickup-and-cross-dock by the usual rule — the row says so.</p>`
    });
  } catch (e) {
    console.error('freightcom notify failed', e.message);
  }
}
