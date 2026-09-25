// Who we are allowed to market to, and the proof that we were.
//
// WHAT WAS WRONG. The campaign email told people to "reply UNSUBSCRIBE" and the
// SMS appended "Reply STOP to opt out". Neither was connected to anything: no
// suppression list, no consent record, and nothing anywhere reading inbound
// replies. The privacy policy promised an unsubscribe LINK the emails did not
// contain. So a person who opted out stayed on the list, and if anyone had ever
// asked why we emailed them, there was no answer to give.
//
// Canada's Anti-Spam Legislation wants three things from a commercial
// electronic message, and we had none of them:
//   1. consent — express (they said yes) or implied (a real business
//      relationship, and only for as long as the statute allows);
//   2. identification of the sender;
//   3. an unsubscribe mechanism that WORKS, stays valid 60 days, and is
//      actioned within 10 business days.
//
// ---------------------------------------------------------------------------
// THIS DOES NOT TOUCH TRANSACTIONAL MAIL, AND MUST NOT.
//
// An order confirmation, an invoice, a delivery notification, a password reset,
// a driver's sign-in code — none of these are commercial electronic messages
// and none require consent. Wiring this into `sendEmail` globally would stop
// order confirmations, which would be a far worse outcome than the problem it
// solves. Only sendEmailCampaign / sendSmsCampaign filter through here.
// ---------------------------------------------------------------------------
//
// EXPRESS CONSENT IS AN EVENT; IMPLIED CONSENT IS A FACT ABOUT A RELATIONSHIP.
// So `consent_events` holds ONLY the things a person actually did — said yes,
// or opted out — and implied consent is DERIVED at read time from their orders
// and quotes. Storing implied consent as a row would be storing a second copy
// of what the orders table already says, and the two would drift. Same reason
// the journal is recomputed rather than posted and a part's stock is a SUM.
//
// The table is APPEND-ONLY. "When did they opt out, and what had they been
// told when they opted in" is the whole question this exists to answer, and an
// UPDATE destroys it.
import { hasDb, query } from './db';
import { captureError } from './observe';
import { phoneKey } from './constants';

// CASL's own windows for implied consent from an existing business
// relationship. These are statutory, not preferences — do not tune them.
export const IMPLIED_PURCHASE_MONTHS = 24;
export const IMPLIED_INQUIRY_MONTHS = 6;

export const CHANNELS = ['email', 'sms'];

// Where a consent came from. Kept as a list so the evidence stays countable —
// same reasoning as LEAD_SOURCES and jobs.services.
export const CONSENT_SOURCES = [
  'signup',          // ticked the box while creating an account
  'checkout',        // ticked the box while ordering
  'quote_request',   // ticked the box asking for a quote
  'admin',           // someone here recorded a verbal yes
  'import',          // migrated from a previous system, with evidence
  'unsubscribe_link', // withdrawal, from the link in an email
  'sms_stop',        // withdrawal, by texting STOP
  'reply',           // withdrawal, from a reply somebody actioned by hand
  'bounce'           // hard bounce / complaint
];

let _schema = null;
export function ensureConsentSchema() {
  if (!hasDb()) return Promise.resolve();
  if (!_schema) {
    _schema = query(`
      CREATE TABLE IF NOT EXISTS consent_events (
        id serial PRIMARY KEY,
        identity text NOT NULL,
        channel  text NOT NULL,
        event    text NOT NULL,
        source   text,
        evidence text,
        ip       text,
        actor    text,
        at       timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_consent_identity
        ON consent_events (identity, channel, at DESC);
    `).catch((e) => { _schema = null; throw e; });
  }
  return _schema;
}

// ---- identity --------------------------------------------------------------
// One spelling per person per channel, or the suppression list has holes in it.
// An opt-out recorded against "Bob@Example.COM " must stop mail to
// "bob@example.com", and a STOP from "+1 (437) 488-8549" must stop texts to
// "4374888549".
export const normEmail = (e) => String(e || '').trim().toLowerCase() || null;

// Re-exported rather than redefined: lib/constants.phoneKey is now the one
// definition, and a suppression list that spells a number differently from the
// customer table has holes in it by construction.
export const normPhone = phoneKey;

export const identityFor = (channel, value) =>
  channel === 'sms' ? normPhone(value) : normEmail(value);

// ---- writing ---------------------------------------------------------------

async function record({ identity, channel, event, source, evidence, ip, actor }) {
  if (!hasDb() || !identity || !CHANNELS.includes(channel)) return null;
  await ensureConsentSchema();
  const { rows } = await query(
    `INSERT INTO consent_events (identity, channel, event, source, evidence, ip, actor)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, at`,
    [identity, channel, event,
     source || null, String(evidence || '').slice(0, 1000) || null,
     ip || null, actor || null]
  );
  return rows[0] || null;
}

/**
 * They said yes. `evidence` should be the words they were actually shown —
 * that sentence IS the proof, and a year from now nobody will remember what
 * the checkbox said.
 */
export async function grantConsent({ channel, email, phone, source, evidence, ip, actor }) {
  const identity = identityFor(channel, channel === 'sms' ? phone : email);
  if (!identity) return null;
  return record({ identity, channel, event: 'granted', source, evidence, ip, actor });
}

/**
 * They opted out. This beats everything, for good: no expiry, and no later
 * purchase silently re-implies it (see `allows` below).
 */
export async function withdrawConsent({ channel, email, phone, source, evidence, ip, actor }) {
  const identity = identityFor(channel, channel === 'sms' ? phone : email);
  if (!identity) return null;
  return record({ identity, channel, event: 'withdrawn', source, evidence, ip, actor });
}

/** Opt out of every channel at once — what "unsubscribe from everything" does. */
export async function withdrawAll({ email, phone, source, evidence, ip, actor }) {
  const out = [];
  if (email) out.push(await withdrawConsent({ channel: 'email', email, source, evidence, ip, actor }));
  if (phone) out.push(await withdrawConsent({ channel: 'sms', phone, source, evidence, ip, actor }));
  return out.filter(Boolean);
}

// ---- reading ---------------------------------------------------------------

/**
 * The latest stated position per identity for one channel.
 * Returns Map<identity, { event, at, source }>.
 */
async function statedFor(identities, channel) {
  const out = new Map();
  if (!hasDb() || !identities.length) return out;
  await ensureConsentSchema();
  const { rows } = await query(
    `SELECT DISTINCT ON (identity) identity, event, at, source
       FROM consent_events
      WHERE channel = $1 AND identity = ANY($2::text[])
      ORDER BY identity, at DESC, id DESC`,
    [channel, identities]
  );
  for (const r of rows) out.set(r.identity, { event: r.event, at: r.at, source: r.source });
  return out;
}

/**
 * Implied consent, derived from the relationship rather than stored.
 * Returns Map<email, { basis, at }>.
 *
 * Email only: a purchase implies consent to be EMAILED under CASL's existing-
 * business-relationship rule. We do not stretch that to text messages, which
 * are more intrusive and which this business has never told anyone it would
 * send. SMS marketing requires an express yes.
 */
async function impliedForEmails(emails) {
  const out = new Map();
  if (!hasDb() || !emails.length) return out;

  // Soft-fail, one query at a time: quotes is self-provisioned by its own
  // module and may not exist on a fresh database. A failure here must mean
  // "no implied consent" — i.e. we send LESS — never "send anyway".
  const purchases = await query(
    `SELECT lower(email) AS em, MAX(created_at) AS at
       FROM orders
      WHERE lower(email) = ANY($1::text[])
        AND status IN ('confirmed','ready','out_for_delivery','delivered')
        AND created_at > now() - ($2 || ' months')::interval
      GROUP BY 1`,
    [emails, String(IMPLIED_PURCHASE_MONTHS)]
  ).catch((e) => {
    captureError(e, { tags: { where: 'consent' }, fingerprint: 'consent:implied-purchase' }).catch(() => {});
    return { rows: [] };
  });
  for (const r of purchases.rows) out.set(r.em, { basis: 'implied_purchase', at: r.at });

  const inquiries = await query(
    `SELECT lower(email) AS em, MAX(created_at) AS at
       FROM quotes
      WHERE lower(email) = ANY($1::text[])
        AND created_at > now() - ($2 || ' months')::interval
      GROUP BY 1`,
    [emails, String(IMPLIED_INQUIRY_MONTHS)]
  ).catch(() => ({ rows: [] }));
  for (const r of inquiries.rows) {
    if (!out.has(r.em)) out.set(r.em, { basis: 'implied_inquiry', at: r.at });
  }

  return out;
}

/**
 * May we send this person a marketing message on this channel, and why.
 *
 * Returns Map<identity, { allowed, basis, since }> where basis is one of
 * 'express' | 'implied_purchase' | 'implied_inquiry' | 'withdrawn' | 'none'.
 */
export async function consentStatus(values, channel) {
  const identities = [...new Set(values.map((v) => identityFor(channel, v)).filter(Boolean))];
  const out = new Map();
  if (!identities.length) return out;

  const stated = await statedFor(identities, channel);
  const implied = channel === 'email' ? await impliedForEmails(identities) : new Map();

  for (const id of identities) {
    const s = stated.get(id);

    // WITHDRAWAL WINS, AND IT DOES NOT EXPIRE. Specifically: a later purchase
    // does NOT re-imply consent for somebody who opted out. Under the
    // relationship rule it arguably could, and doing so would be indefensible
    // to the person who pressed unsubscribe and then bought a fridge anyway.
    if (s && s.event === 'withdrawn') {
      out.set(id, { allowed: false, basis: 'withdrawn', since: s.at });
      continue;
    }
    if (s && s.event === 'granted') {
      out.set(id, { allowed: true, basis: 'express', since: s.at });
      continue;
    }
    const imp = implied.get(id);
    if (imp) {
      out.set(id, { allowed: true, basis: imp.basis, since: imp.at });
      continue;
    }
    // No yes, and no relationship recent enough to imply one.
    out.set(id, { allowed: false, basis: 'none', since: null });
  }
  return out;
}

export const BASIS_LABEL = {
  express: 'said yes',
  implied_purchase: `bought in the last ${IMPLIED_PURCHASE_MONTHS} months`,
  implied_inquiry: `asked for a quote in the last ${IMPLIED_INQUIRY_MONTHS} months`,
  withdrawn: 'opted out',
  none: 'no consent on record'
};

/**
 * Split a recipient list into who may be messaged and who may not.
 *
 * FAILS CLOSED. Every other guard in this codebase degrades open, because
 * losing a real sale is worse than admitting a junk one. This one is the
 * opposite and deliberately so: the cost of wrongly sending is a statutory
 * penalty and a person who asked us to stop being emailed anyway, and the cost
 * of wrongly not sending is one marketing message that goes out tomorrow
 * instead. If the consent table cannot be read, nothing is sent.
 */
export async function filterAudience(recipients, channel) {
  const field = channel === 'sms' ? 'phone' : 'email';
  const withValue = recipients.filter((r) => r && r[field]);
  const noValue = recipients.length - withValue.length;

  let status;
  try {
    status = await consentStatus(withValue.map((r) => r[field]), channel);
  } catch (e) {
    await captureError(e, { tags: { where: 'consent' }, fingerprint: 'consent:filter-failed' });
    return {
      allowed: [],
      blocked: [],
      failed: true,
      counts: { total: recipients.length, allowed: 0, withdrawn: 0, noConsent: 0, noValue },
      reason: 'The consent list could not be read, so nothing was sent.'
    };
  }

  const allowed = [], blocked = [];
  let withdrawn = 0, noConsent = 0;
  for (const r of withValue) {
    const st = status.get(identityFor(channel, r[field])) || { allowed: false, basis: 'none' };
    if (st.allowed) { allowed.push({ ...r, consentBasis: st.basis }); continue; }
    if (st.basis === 'withdrawn') withdrawn++; else noConsent++;
    blocked.push({ ...r, reason: st.basis });
  }

  return {
    allowed, blocked, failed: false,
    counts: { total: recipients.length, allowed: allowed.length, withdrawn, noConsent, noValue }
  };
}

/** The audit trail for one person — what the admin screen shows. */
export async function consentHistory({ email, phone }) {
  if (!hasDb()) return [];
  await ensureConsentSchema();
  const ids = [normEmail(email), normPhone(phone)].filter(Boolean);
  if (!ids.length) return [];
  const { rows } = await query(
    `SELECT identity, channel, event, source, evidence, actor, at
       FROM consent_events WHERE identity = ANY($1::text[])
      ORDER BY at DESC, id DESC LIMIT 200`,
    [ids]
  );
  return rows;
}
