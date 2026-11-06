// Who an e-transfer went to, read from Interac's own confirmation email.
//
// WHY THIS EXISTS. The bank feed (Plaid) carries NO recipient on a TD e-transfer:
// the line is `SEND E-TFR *nMU EXP`, a reference code and the memo the sender
// typed. The recipient's name is not in the feed at all. It IS in the confirmation
// Interac emails the sender, and that email carries the exact amount:
//   "Interac e-Transfer: Your $1,356.00 transfer to OURR HOME & APPLIANCES has been
//    successfully deposited."
// So an e-transfer line can be named by finding the email with the same amount,
// close in date. Those emails go to the owner's own Gmail, which is forwarded to a
// mailbox this app can read (INTERAC_INBOX, default Service@rssolutions.ca).
//
// THE RULE THAT MATTERS: IT NEVER GUESSES. Many transfers are the same round
// amount ($500, a dozen times in a month, to different people). A line is named
// only when exactly one email could be it AND exactly one line could be that email.
// An ambiguous pair is left for a person: a wrong name on a supplier payment is
// worse than a blank one. A name a person typed is never overwritten.
import { query, hasDb } from './db';
import { getSetting, setSetting } from './settings';
import { sendEmail } from './email';
import { SERVICE_EMAIL } from './constants';
import { gmailConfigured, listSubjects } from './gmail';
import { ensureFinanceSchema } from './finance';

const INBOX = () => process.env.INTERAC_INBOX || SERVICE_EMAIL;
export const INTERAC_QUERY = 'from:payments.interac.ca subject:"has been successfully deposited" newer_than:60d';

// ---- pure ----------------------------------------------------------------------

/** "Interac e-Transfer: Your $1,356.00 transfer to NAME has been successfully deposited." */
export function parseInteracSent({ subject, date, internalDate } = {}) {
  const m = /your\s+\$\s*([\d,]+(?:\.\d{1,2})?)\s+transfer\s+to\s+(.+?)\s+has\s+been\s+successfully\s+deposited/i.exec(String(subject || ''));
  if (!m) return null;
  const amountCents = Math.round(Number(m[1].replace(/,/g, '')) * 100);
  const name = m[2].replace(/\s+/g, ' ').trim();
  if (!(amountCents > 0) || !name) return null;
  const t = internalDate || Date.parse(date || '');
  return { amountCents, name: name.slice(0, 120), at: Number.isFinite(t) ? t : null };
}

/** A bank line that is an e-transfer SENT (the only kind this can name). */
export function looksLikeSentTransfer(desc) {
  const t = String(desc || '');
  return /e-?\s?(tfr|transfer)/i.test(t) && !/receiv|deposit/i.test(t);
}

const DAY = 86400e3;
/**
 * emails: [{ id, amountCents, name, at }]; lines: [{ id, grossCents, date (YYYY-MM-DD) }].
 * Returns [{ lineId, emailId, name }] for the UNAMBIGUOUS pairs only.
 * The money leaves the account when the transfer is SENT; the "deposited" email
 * follows when it is accepted, so the email is the same day or later: a line
 * pairs with an email dated from a day before the line to a week after it.
 */
export function matchTransfers(emails, lines) {
  const cands = new Map(); // lineId -> [email]
  const byEmail = new Map(); // emailId -> [lineId]
  for (const l of lines) {
    const t = Date.parse(`${l.date}T12:00:00Z`);
    const list = emails.filter((e) => e.amountCents === l.grossCents && e.at != null
      && e.at >= t - 1.5 * DAY && e.at <= t + 8 * DAY);
    cands.set(l.id, list);
    for (const e of list) byEmail.set(e.id, [...(byEmail.get(e.id) || []), l.id]);
  }
  const out = [];
  for (const l of lines) {
    const list = cands.get(l.id) || [];
    if (list.length !== 1) continue;                 // none, or several emails could be it
    if ((byEmail.get(list[0].id) || []).length !== 1) continue; // several lines could be that email
    out.push({ lineId: l.id, emailId: list[0].id, name: list[0].name });
  }
  return out;
}

// ---- the job -------------------------------------------------------------------

const USED_KEY = 'interac_used_emails';
const ALERT_KEY = 'interac_alert';

async function alert(subject, body) {
  try {
    const last = await getSetting(ALERT_KEY, null);
    if (last && last.body === body && Date.now() - new Date(last.at).getTime() < 24 * 3600e3) return;
    await setSetting(ALERT_KEY, { body, at: new Date().toISOString() });
    await sendEmail({ to: SERVICE_EMAIL, subject: `[Books] ${subject}`,
      html: `<p><b>Naming e-transfers from Interac emails needs a look.</b></p><p>${body}</p>
        <p style="color:#777;font-size:12px">Not repeated for 24 hours unless the problem changes.</p>` });
  } catch (e) { console.error('interac alert failed', e?.message || e); }
}

/**
 * Name the e-transfer lines in the ledger from Interac's confirmation emails.
 * `emailsFn` is injectable so the matching can be tested without a mailbox.
 */
export async function nameTransfersFromEmail({ dryRun = false, emailsFn = null } = {}) {
  if (!hasDb()) return { ok: false, reason: 'no database' };
  let raw;
  if (emailsFn) raw = await emailsFn();
  else {
    if (!gmailConfigured()) {
      const reason = 'Gmail is not configured (GOOGLE_CREDENTIALS / SARAH_EMAIL_INBOXES).';
      if (!dryRun) await alert('Interac names: Gmail is not configured', reason);
      return { ok: false, reason };
    }
    try { raw = (await listSubjects(INBOX(), { query: INTERAC_QUERY, max: 300 })).emails; }
    catch (e) {
      const reason = `could not read ${INBOX()}: ${e?.message || e}. The mailbox has to be connected (SARAH_EMAIL_INBOXES or GMAIL_EXTRA_INBOXES) and covered by domain-wide delegation.`;
      if (!dryRun) await alert(`Interac names: cannot read ${INBOX()}`, reason);
      return { ok: false, reason };
    }
  }
  const emails = raw.map((e) => ({ id: e.id, ...parseInteracSent(e) })).filter((e) => e.amountCents);

  await ensureFinanceSchema();
  const used = new Set(await getSetting(USED_KEY, []).catch(() => []));
  const free = emails.filter((e) => !used.has(e.id));

  // Sent e-transfers with nobody named yet, recent enough that an email could exist.
  const { rows } = await query(
    `SELECT id, incurred_on, amount, tax, bank_desc, vendor FROM expenses
      WHERE source = 'plaid' AND payee_override IS NULL AND payee IS NULL
        AND incurred_on >= (now() - interval '75 days')::date`
  );
  const lines = rows
    .filter((r) => looksLikeSentTransfer(r.bank_desc || r.vendor))
    .map((r) => ({
      id: r.id,
      date: new Date(r.incurred_on).toISOString().slice(0, 10),
      grossCents: Math.round((Number(r.amount) + (r.tax == null ? 0 : Number(r.tax))) * 100)
    }));

  const pairs = matchTransfers(free, lines);
  const named = [];
  if (!dryRun) {
    for (const p of pairs) {
      const e = free.find((x) => x.id === p.emailId);
      const when = e?.at ? new Date(e.at).toISOString().slice(0, 10) : '';
      const r = await query(
        `UPDATE expenses SET payee_override = $2, vendor = $2,
                user_note = COALESCE(user_note, $3)
          WHERE id = $1 AND payee_override IS NULL`,
        [p.lineId, p.name, `Recipient from Interac's confirmation email${when ? ` (${when})` : ''}`]
      );
      if (r.rowCount) { named.push({ id: p.lineId, name: p.name }); used.add(p.emailId); }
    }
    if (named.length) await setSetting(USED_KEY, [...used].slice(-3000));
  } else {
    for (const p of pairs) named.push({ id: p.lineId, name: p.name, dryRun: true });
  }
  return {
    ok: true, inbox: emailsFn ? null : INBOX(),
    emails: emails.length, lines: lines.length, named,
    // Lines still blank, so the screen can say "N need a person".
    left: lines.length - pairs.length
  };
}
