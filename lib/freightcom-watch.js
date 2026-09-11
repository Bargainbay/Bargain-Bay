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
// THE TRAP, and the reason this file is not just "read the BOL":
//   A BOL names the FINAL-MILE consignee. RS does not drive there. RS collects
//   from the shipper and drops at SecondShop's warehouse; VA Transport takes it
//   the last leg. So a straight read of the BOL produces a stop pointed at the
//   customer's house — exactly the wrong door, and it would look completely
//   plausible on the board. Every row is therefore REDIRECTED: the drop becomes
//   the SecondShop warehouse, the consignee is preserved in the note so the leg
//   is still traceable, and the redirect is written where a human will read it.
//   This mirrors the Quebec rule in lib/stop-import.js, which exists for the
//   same reason.
import { gmailConfigured, listAttachmentEmails, getAttachment, readEmail } from './gmail';
import { extractStopsFromPdf, PDF_COLUMNS } from './pdf-stops';
import { stageBatch, alreadyStaged, ensureImportSchema } from './import-batches';
import { getSetting } from './settings';
import { sendEmail } from './email';
import { dispatchDesk } from './constants';

// Which mailbox to read. The delivery desk, because that is where the filter
// puts this mail and it holds nothing else — pointing this at Service@ would
// have it reading the owner's whole inbox to find four emails.
const WATCH_INBOX = () => process.env.FREIGHTCOM_INBOX || dispatchDesk();

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

// Where RS actually takes these. A SETTING, not a constant: it is one company's
// warehouse and it will move. Unset is not an error — the batch still stages,
// with the drop blank and the question sitting on the row, which is a great deal
// better than inventing an address or refusing the whole email.
export async function secondshopDrop() {
  const raw = await getSetting('secondshop_drop', '');
  const [address, city, postal] = String(raw || '').split('|').map((s) => s.trim());
  return { address: address || '', city: city || '', postal: postal || '', set: !!address };
}

// Turn one BOL row into the leg RS actually drives.
//
// `row` arrives in PDF_COLUMNS order. The consignee columns are overwritten with
// the warehouse and folded into the note — losing them would make the stop
// untraceable back to the customer it belongs to, which is what everyone asks
// about when a unit goes missing.
export function redirectToHub(row, drop, { bol, service } = {}) {
  const at = (name) => {
    const i = PDF_COLUMNS.indexOf(name);
    return i >= 0 ? String(row[i] ?? '').trim() : '';
  };
  const set = (name, v) => {
    const i = PDF_COLUMNS.indexOf(name);
    if (i >= 0) row[i] = v;
  };

  const finalMile = [at('Customer'), at('Address'), at('City'), at('Postal code')]
    .filter(Boolean).join(', ');

  const note = [
    bol ? `BOL ${bol}` : '',
    service || '',
    'RS leg: collect → SecondShop',
    finalMile ? `FINAL MILE (not ours): ${finalMile} — VA Transport` : '',
    at('Notes')
  ].filter(Boolean).join(' · ');

  // The pickup end of the BOL becomes our collection; the drop becomes the hub.
  set('Customer', 'SecondShop — inbound');
  set('Address', drop.address);
  set('City', drop.city);
  set('Postal code', drop.postal);
  set('Notes', note);
  return { row, finalMile };
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

  const drop = await secondshopDrop();
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

      const service = (SERVICE_RE.exec(full.body) || [])[1] || '';
      const rows = read.stops.map((r) => redirectToHub([...r], drop, { bol, service }).row);

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

  if (staged.length && !dryRun) await notifyDesk(staged, drop);
  return { ok: true, inbox, scanned: emails.length, staged, skipped, failed, dropSet: drop.set };
}

// Tell the desk there is something to review. Best-effort and last: a mail
// hiccup must never undo work that is already staged and safe.
async function notifyDesk(staged, drop) {
  try {
    const lines = staged.map((s) => `<li>${s.bol || s.subject} — ${s.rows} stop${s.rows === 1 ? '' : 's'}</li>`).join('');
    await sendEmail({
      to: dispatchDesk(),
      subject: `[Dispatch] ${staged.length} Freightcom pickup${staged.length === 1 ? '' : 's'} waiting for review`,
      brand: 'rs_solutions',
      html: `<p>These came in from Parallel and have been read and staged. <b>They are not on the board yet.</b></p>
        <ul>${lines}</ul>
        ${drop.set ? '' : '<p><b>No SecondShop drop address is set</b>, so every one of these is missing its delivery end. Set it on the dispatch page.</p>'}
        <p>Open the Import tab on dispatch to check them and put them on a day.</p>`
    });
  } catch (e) {
    console.error('freightcom notify failed', e.message);
  }
}
