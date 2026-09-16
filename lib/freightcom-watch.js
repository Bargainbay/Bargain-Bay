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
import { extractStopsFromPdf, extractStopsFromEmail, PDF_COLUMNS } from './pdf-stops';
import { stageBatch, alreadyStaged, ensureImportSchema } from './import-batches';
import { sendEmail } from './email';
import { dispatchDesk } from './constants';
import { getSetting, setSetting } from './settings';

// Which mailbox to read. The delivery desk, because that is where the filter
// puts this mail and it holds nothing else — pointing this at Service@ would
// have it reading the owner's whole inbox to find four emails.
const WATCH_INBOX = () => process.env.FREIGHTCOM_INBOX || dispatchDesk();

// Only the carrier's own notifications, only with something to read. The thread
// then fills with replies ("BOL printed") that carry the SAME subject and the
// SAME forwarded attachment — `from:` is what keeps those out, and the BOL
// number is what catches any that slip through.
// `filename:pdf` used to be on the end of this, and it did not skip a no-PDF
// notification — it hid it. Gmail never returned the email, so it could not be
// counted, reported or even known about, and the "no PDF on it" branch below was
// effectively dead. The owner knew those emails existed because he could see
// them in the mailbox; the watcher could not. So the search now asks for the
// carrier's notifications and decides what is readable HERE, where it can say so.
const QUERY = 'from:parallelsupplychain.com subject:"Freightcom Pick Up Notification" '
  + 'newer_than:14d';

// A scan or a phone photo of the paperwork reads perfectly well — extractStopsFromPdf
// takes an image block as happily as a document one (lib/pdf-stops.js). Looking
// only for a PDF threw those away for no reason anybody had decided on.
const READABLE = /(pdf|image\/(png|jpe?g|webp|heic|heif))/i;

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
  if (!gmailConfigured()) {
    const reason = 'gmail not configured (GOOGLE_CREDENTIALS / SARAH_EMAIL_INBOXES)';
    if (!dryRun) await alert('Freightcom import is not configured', reason);
    return { ok: false, reason };
  }
  await ensureImportSchema();

  const inbox = WATCH_INBOX();
  let emails = [];
  try {
    ({ emails } = await listAttachmentEmails(inbox, { query: QUERY, max, includeEmpty: true }));
  } catch (e) {
    // The commonest cause by far is the mailbox not being on SARAH_EMAIL_INBOXES,
    // or domain-wide delegation not covering this domain. Say which, rather than
    // letting a silent empty result look like a quiet day.
    console.error('freightcom list failed', e.message);
    const reason = `could not read ${inbox}: ${e.message}`;
    if (!dryRun) await alert(`Freightcom import could not read ${inbox}`, reason);
    return { ok: false, reason };
  }

  const staged = [], skipped = [], failed = [], attention = [];

  for (const em of emails) {
    let bol = null;
    try {
      // The BOL number lives in the BODY (the Freightcom block), not the subject.
      const full = await readEmail(inbox, em.id);
      bol = bolNumber(full.body) || bolNumber(em.subject);
      const key = bol ? `bol:${bol}` : `msg:${em.id}`;

      if (await alreadyStaged(key)) { skipped.push({ bol, subject: em.subject, why: 'already staged' }); continue; }

      // The PDF first, then a scan or a photo of the same paperwork.
      const atts = em.attachments || [];
      const doc = atts.find((a) => (a.mimeType || '').includes('pdf'))
        || atts.find((a) => READABLE.test(a.mimeType || ''));
      // No paperwork attached — so read the email itself. Sometimes the
      // addresses are simply written in the body, and those used to be dropped
      // twice over: the search hid them, and the loop had nowhere to send them.
      // `extractStopsFromEmail` returns zero rows rather than throwing when the
      // body is a covering note, which is most of them.
      let read, from;
      if (!doc) {
        from = 'the email body';
        read = await extractStopsFromEmail({ text: full.body });
        if (!read.rows?.length) {
          attention.push({ bol, subject: em.subject, date: em.date,
            why: atts.length
              ? `nothing readable attached (${atts.map((a) => a.mimeType || '?').join(', ')}), and no address in the body`
              : 'no attachment, and no address in the body' });
          continue;
        }
      } else {
        from = doc.mimeType?.includes('pdf') ? 'the PDF' : 'an attached scan';
        const { base64 } = await getAttachment(inbox, em.id, doc.attachmentId);
        read = await extractStopsFromPdf({ base64, mediaType: doc.mimeType });
      }
      // `extractStopsFromPdf` returns ROWS, not `stops` — `stops` is only the
      // shape the model replies in, inside that function. Reading the wrong key
      // here reported "nothing readable" for all 8 live BOLs whatever the
      // extractor had actually found, which looked exactly like every one of
      // those PDFs being unreadable. Keep the two names straight.
      if (!read.rows?.length) { failed.push({ bol, subject: em.subject, why: `no stop found in ${from}` }); continue; }

      // Rows go in AS READ. The only change is the note: the BOL number and the
      // service level are in the covering email, not the PDF, and both matter to
      // whoever drives it — "Delivery to Threshold" is the difference between
      // leaving it at the door and carrying it in.
      const service = (SERVICE_RE.exec(full.body) || [])[1] || '';
      const noteIdx = PDF_COLUMNS.indexOf('Notes');
      const rows = read.rows.map((r) => {
        const row = [...r];
        row[noteIdx] = [bol ? `BOL ${bol}` : '', service, String(row[noteIdx] ?? '').trim()]
          .filter(Boolean).join(' · ');
        return row;
      });

      if (dryRun) { staged.push({ bol, subject: em.subject, rows: rows.length, dryRun: true }); continue; }

      const batch = await stageBatch({
        headers: PDF_COLUMNS,
        rows,
        sourceName: `Freightcom ${bol || em.subject}${doc ? '' : ' (from the email body)'}`.slice(0, 200),
        readAs: 'ai',
        sourceMsgId: key,
        // Deliberately no jobDate. The shipment date on the notification is when
        // the CARRIER wanted it moved, which is routinely not the day RS runs it
        // — on the three that prompted this, the reply said "tomorrow". Left
        // open, it becomes the batch's first question instead of a wrong answer
        // nobody looks at twice.
        createdBy: { email: 'freightcom-watch', name: 'Freightcom watcher' }
      });
      staged.push({ bol, subject: em.subject, rows: rows.length, from, batchId: batch?.id ?? null });
    } catch (e) {
      console.error('freightcom stage failed', em.id, e.message);
      failed.push({ bol, subject: em.subject, why: e.message });
    }
  }

  if (!dryRun) await report({ staged, failed, attention });
  return { ok: true, inbox, scanned: emails.length, staged, skipped, failed, attention };
}

// Tell the desk what happened. This used to fire ONLY when something staged
// successfully, which meant the one morning worth hearing about — eight BOLs in
// and every one of them unreadable — looked exactly like a quiet day with no
// mail. Silence was indistinguishable from nothing-to-do, and the owner found
// out by noticing the board was empty.
//
// So: a run that staged anything reports, as before. A run that staged nothing
// and hit problems reports too — THROTTLED, because this runs every fifteen
// minutes and a broken mailbox would otherwise send sixty-eight identical
// emails in a day, which is its own kind of silence.
const ALERT_KEY = 'freightcom_alert';
const QUIET_HOURS = 6;

async function alert(subject, body) {
  try {
    const now = Date.now();
    const last = await getSetting(ALERT_KEY, null);
    // Keyed on the MESSAGE, so a new problem is always heard immediately even
    // if an old one is inside its quiet window.
    if (last && last.body === body && now - new Date(last.at).getTime() < QUIET_HOURS * 3600e3) return;
    await setSetting(ALERT_KEY, { body, at: new Date(now).toISOString() });
    await sendEmail({
      to: dispatchDesk(),
      subject: `[Dispatch] ${subject}`,
      brand: 'rs_solutions',
      html: `<p><b>The Freightcom import needs a look.</b></p><p>${body}</p>
        <p>Nothing has been staged from it. You can retry from the Import tab with
        <b>Check Freightcom mail</b> once it is sorted.</p>
        <p style="color:#777;font-size:12px">You will not get this again for ${QUIET_HOURS} hours
        unless the problem changes.</p>`
    });
  } catch (e) {
    console.error('freightcom alert failed', e.message);
  }
}

function li(rows, fmt) { return rows.map((r) => `<li>${fmt(r)}</li>`).join(''); }

async function report({ staged, failed, attention }) {
  // An email nothing can be read from is never marked staged, so it comes back
  // every run for the fortnight the search looks over. Saying so once or twice
  // is useful; saying it ninety times is how a person learns to skip these
  // emails, and then the one that mattered goes past unread. So it is mentioned
  // while it is NEW and quietly left alone afterwards — it is still in the
  // mailbox, and the desk has already been told.
  const fresh = attention.filter((a) => {
    const t = Date.parse(a.date || '');
    return !Number.isFinite(t) || Date.now() - t < 3 * 86400e3;
  });
  if (!staged.length && !failed.length && !fresh.length) return; // a genuinely quiet run
  const problems = [...failed, ...fresh];

  // Nothing came in, but something went wrong: throttled, because the next run
  // is fifteen minutes away and will find exactly the same thing.
  if (!staged.length) {
    return alert(
      `${problems.length} Freightcom email${problems.length === 1 ? '' : 's'} nothing could be read from`,
      problems.map((p) => `${p.bol || p.subject} — ${p.why}`).join('<br>')
    );
  }

  try {
    await sendEmail({
      to: dispatchDesk(),
      subject: `[Dispatch] ${staged.length} Freightcom pickup${staged.length === 1 ? '' : 's'} waiting for review`,
      brand: 'rs_solutions',
      html: `<p>These came in from Parallel and have been read and staged. <b>They are not on the board yet.</b></p>
        <ul>${li(staged, (s2) => `${s2.bol || s2.subject} — ${s2.rows} stop${s2.rows === 1 ? '' : 's'}`
    + `${s2.from && s2.from !== 'the PDF' ? ` <b>(read from ${s2.from})</b>` : ''}`)}</ul>
        ${problems.length ? `<p><b>And ${problems.length} nothing was read from:</b></p>
          <ul>${li(problems, (p) => `${p.bol || p.subject} — ${p.why}`)}</ul>
          <p>Those are not on the board and are not staged. If one of them was real work,
          it needs adding by hand.</p>` : ''}
        <p>Open the Import tab on dispatch to check them and put them on a day. A Quebec-bound
        one is turned into a pickup-and-cross-dock by the usual rule — the row says so.</p>`
    });
  } catch (e) {
    console.error('freightcom notify failed', e.message);
  }
}
