// Signing the business-development rep's agreements inside the Sales Hub, and keeping the copy.
//
// WHAT SIGNING IS: the rep reads both documents to the end, types their full legal name and home address,
// ticks that they have read and agree, and presses Sign. We record the typed name, the time, the IP and the
// browser, and store the exact text they saw with its hash (rep_agreements, migration 0065). An electronic
// signature of this kind is valid in Ontario (Electronic Commerce Act, 2000) when the person intended to sign;
// whether a given clause is enforceable is the lawyer's question, not this module's.
//
// RULES THAT MUST HOLD
//  - IDENTITY IS THE SESSION. The rep is whoever is signed in; no email or id from a request is ever used.
//  - THE TEXT SIGNED = THE TEXT SHOWN. The page carries the hash of the text it displayed; if the wording (or the
//    commission tiers it is built from) changed since the page loaded, signing is refused and asks for a reload.
//  - SIGNING IS CLOSED until an admin opens it AND no [bracketed] decision is left in the text. The documents are
//    drafts for a lawyer; a signature on a text with "[registered address]" in it is worth nothing.
//  - ONE SIGNATURE PER DOCUMENT PER VERSION (unique index). Both documents are signed in one transaction or neither.
//  - THE COMPANY'S COUNTERSIGNATURE is a separate, later, admin-only act. A copy says "awaiting countersignature"
//    until then rather than pretending the company has signed.
//  - A MAIL FAILURE NEVER UNDOES A SIGNATURE. The copy is also on screen and printable.
import { createHash } from 'node:crypto';
import { query, hasDb, withTransaction } from './db';
import { getSetting, setSetting } from './settings';
import { getTiers } from './sales-commission';
import { audit } from './audit';
import { sendEmail, esc } from './email';
import { SERVICE_EMAIL } from './constants';
import {
  EMPLOYMENT_TERMS_VERSION, FIELD_DEFS, COMPANY_NAME, COMPANY_SIGNATORY,
  employmentSections, confidentialitySections, sectionsText, unresolvedItems
} from './employment-terms';

export class AgreementError extends Error {
  constructor(message, code = 'invalid') { super(message); this.code = code; }
}

const norm = (e) => String(e || '').trim().toLowerCase();
const sha = (s) => createHash('sha256').update(s).digest('hex');
export const DOCS = [
  { key: 'employment', title: 'Offer of Employment and Employment Agreement' },
  { key: 'confidentiality', title: 'Confidentiality and Non-Solicitation Agreement' }
];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS rep_agreements (
    id serial PRIMARY KEY, rep_email text NOT NULL, doc text NOT NULL CHECK (doc IN ('employment', 'confidentiality')),
    version text NOT NULL, text_hash text NOT NULL, text_snapshot text NOT NULL, signed_name text NOT NULL,
    employee_address text, signed_at timestamptz NOT NULL DEFAULT now(), ip text, user_agent text,
    countersigned_by text, countersigned_name text, countersigned_at timestamptz);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_agreements_once ON rep_agreements (lower(rep_email), doc, version);`;
let ensured = null;
async function ensure() {
  if (!hasDb()) return;
  if (ensured) return ensured;
  ensured = query(SCHEMA).catch((e) => { ensured = null; throw e; });
  return ensured;
}

// ---- the owner's decisions (fields) and the open/closed switch ----
export async function getFields() {
  const v = await getSetting('rep_agreement_fields', {});
  const out = {};
  for (const d of FIELD_DEFS) out[d.key] = String(v?.[d.key] ?? '').trim();
  return out;
}
export async function setFields(session, fields) {
  const clean = {};
  for (const d of FIELD_DEFS) clean[d.key] = String(fields?.[d.key] ?? '').trim().slice(0, 300);
  await setSetting('rep_agreement_fields', clean);
  await audit(session, { action: 'rep_agreement.fields', entity: 'rep_agreement', entityId: 'fields', summary: 'Edited the rep agreement details', detail: clean });
  return clean;
}
export const isOpen = async () => (await getSetting('rep_agreement_open', false)) === true;
export async function setOpen(session, open) {
  await setSetting('rep_agreement_open', !!open);
  await audit(session, { action: 'rep_agreement.open', entity: 'rep_agreement', entityId: 'open', summary: open ? 'Opened rep agreement for signing' : 'Closed rep agreement for signing' });
  return !!open;
}

/** Both documents as they stand now (live tiers + owner's fields), with the employee filled in when known. */
export async function buildDocs(employee = {}) {
  const [tiers, fields] = await Promise.all([getTiers(), getFields()]);
  const employment = employmentSections({ tiers, fields, employee });
  const confidentiality = confidentialitySections({ employee });
  return { tiers, fields, employment, confidentiality };
}
const templateHash = (d) => sha(`${EMPLOYMENT_TERMS_VERSION}\n${sectionsText(d.employment)}\n--\n${sectionsText(d.confidentiality)}`);

export async function signedRows(email) {
  if (!hasDb() || !email) return [];
  await ensure();
  const { rows } = await query('SELECT * FROM rep_agreements WHERE lower(rep_email) = $1 AND version = $2 ORDER BY doc', [norm(email), EMPLOYMENT_TERMS_VERSION]);
  return rows;
}

/** Everything the rep's agreement screen needs. */
export async function agreementState(email) {
  const [docs, open, rows] = await Promise.all([buildDocs({}), isOpen(), signedRows(email)]);
  const unresolved = unresolvedItems(docs.employment, docs.confidentiality);
  return {
    version: EMPLOYMENT_TERMS_VERSION,
    employment: docs.employment, confidentiality: docs.confidentiality,
    hash: templateHash(docs), unresolved, open,
    canSign: open && unresolved.length === 0,
    signed: rows.length >= DOCS.length ? {
      name: rows[0].signed_name, at: rows[0].signed_at, address: rows[0].employee_address,
      countersigned: rows.every((r) => r.countersigned_at) ? { name: rows[0].countersigned_name, at: rows[0].countersigned_at } : null
    } : null
  };
}

export async function signAgreement(session, { typedName, address, agreed, hash, ip = null, userAgent = null }) {
  if (!hasDb()) throw new AgreementError('The database is not configured.', 'nodb');
  await ensure();
  const email = norm(session?.email);
  if (!email) throw new AgreementError('Sign in first.', 'auth');
  const name = String(typedName || '').trim().replace(/\s+/g, ' ');
  const home = String(address || '').trim().replace(/\s+/g, ' ');
  if (agreed !== true) throw new AgreementError('Tick the box to confirm you have read and agree.');
  if (name.length < 3 || !/\s/.test(name)) throw new AgreementError('Type your full legal name (first and last) as your signature.');
  if (home.length < 8) throw new AgreementError('Enter your home address.');
  if (!(await isOpen())) throw new AgreementError('Signing is not open yet. The owner will open it when the agreement is ready.', 'closed');

  const tpl = await buildDocs({});
  if (unresolvedItems(tpl.employment, tpl.confidentiality).length) throw new AgreementError('The agreement still has blanks the company must fill in. Ask the owner.', 'blanks');
  if (hash !== templateHash(tpl)) throw new AgreementError('The agreement changed while this page was open. Reload it and read it again before signing.', 'stale');

  // What is stored is the text WITH the signer's name and address in it: the document as signed.
  const signedDocs = await buildDocs({ name, address: home });
  const texts = { employment: sectionsText(signedDocs.employment), confidentiality: sectionsText(signedDocs.confidentiality) };
  try {
    await withTransaction(async (c) => {
      for (const d of DOCS) {
        await c.query(
          `INSERT INTO rep_agreements (rep_email, doc, version, text_hash, text_snapshot, signed_name, employee_address, ip, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [email, d.key, EMPLOYMENT_TERMS_VERSION, sha(texts[d.key]), texts[d.key], name, home, ip, userAgent]);
      }
    });
  } catch (e) {
    if (e?.code === '23505') throw new AgreementError('You have already signed this agreement.', 'already');
    throw e;
  }
  await audit(session, { action: 'rep_agreement.sign', entity: 'rep_agreement', entityId: email, summary: `${name} signed the employment and confidentiality agreements`, detail: { version: EMPLOYMENT_TERMS_VERSION } });
  const mail = await mailCopy(email).catch((e) => ({ ok: false, error: e?.message }));
  return { ok: true, emailed: !!mail?.ok };
}

/** The signed copy: both documents, who signed, when, and the company's countersignature if any. */
export async function copyFor(email) {
  const rows = await signedRows(email);
  if (rows.length < DOCS.length) return null;
  const by = Object.fromEntries(rows.map((r) => [r.doc, r]));
  const first = rows[0];
  return {
    version: first.version, signedName: first.signed_name, address: first.employee_address, signedAt: first.signed_at,
    countersigned: rows.every((r) => r.countersigned_at) ? { name: first.countersigned_name, at: first.countersigned_at } : null,
    docs: DOCS.map((d) => ({ key: d.key, title: d.title, text: by[d.key].text_snapshot, hash: by[d.key].text_hash }))
  };
}

const when = (t) => new Date(t).toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'long', timeStyle: 'short' });

export function copyHtml(c) {
  const parts = c.docs.map((d) => `<h2 style="font-size:16px;margin:22px 0 6px">${esc(d.title)}</h2><pre style="white-space:pre-wrap;font:13px/1.5 Georgia,serif;margin:0">${esc(d.text)}</pre>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:720px;margin:0 auto;color:#222">
    <h1 style="font-size:20px">Signed copy: employment agreements</h1>
    <p style="font-size:14px">Signed electronically by <b>${esc(c.signedName)}</b> on ${esc(when(c.signedAt))} (Toronto time).${c.countersigned ? ` Countersigned for ${esc(COMPANY_NAME)} by ${esc(c.countersigned.name)} on ${esc(when(c.countersigned.at))}.` : ` Awaiting countersignature for ${esc(COMPANY_NAME)}.`}</p>
    ${parts}
    <p style="font-size:12px;color:#666;margin-top:20px">Version ${esc(c.version)}. Document fingerprints (sha256): ${c.docs.map((d) => esc(d.hash.slice(0, 16))).join(', ')}.</p></div>`;
}

/** Email the signed copy to the rep and the office. Returns { ok }. Never throws into a signature. */
export async function mailCopy(email) {
  const c = await copyFor(email);
  if (!c) throw new AgreementError('Nothing signed yet.', 'none');
  const html = copyHtml(c);
  const subject = `Signed copy: employment agreements, ${c.signedName}`;
  const [a, b] = await Promise.all([
    sendEmail({ to: email, subject, html }),
    sendEmail({ to: SERVICE_EMAIL, subject: `Office copy: ${subject}`, html })
  ]);
  return { ok: !!a?.ok, office: !!b?.ok };
}

// ---- the owner's side ----
export async function signatureList() {
  if (!hasDb()) return [];
  await ensure();
  const { rows } = await query(
    `SELECT lower(rep_email) AS email, max(signed_name) AS name, max(version) AS version, min(signed_at) AS signed_at, count(*)::int AS docs,
            count(countersigned_at)::int AS countersigned, max(countersigned_name) AS countersigned_name, max(countersigned_at) AS countersigned_at
       FROM rep_agreements GROUP BY lower(rep_email), version ORDER BY min(signed_at) DESC`);
  return rows;
}

export async function countersign(session, repEmail, typedName) {
  await ensure();
  const email = norm(repEmail);
  const name = String(typedName || '').trim().replace(/\s+/g, ' ');
  if (name.length < 3) throw new AgreementError(`Type the name of the person signing for the company (${COMPANY_SIGNATORY}).`);
  const { rows } = await query(
    `UPDATE rep_agreements SET countersigned_by = $2, countersigned_name = $3, countersigned_at = now()
      WHERE lower(rep_email) = $1 AND version = $4 AND countersigned_at IS NULL RETURNING id`, [email, norm(session?.email), name, EMPLOYMENT_TERMS_VERSION]);
  if (!rows.length) throw new AgreementError('Nothing to countersign: not signed by the rep yet, or already countersigned.', 'none');
  await audit(session, { action: 'rep_agreement.countersign', entity: 'rep_agreement', entityId: email, summary: `Countersigned ${email}'s agreements as ${name}` });
  const mail = await mailCopy(email).catch(() => ({ ok: false }));
  return { ok: true, emailed: !!mail.ok };
}
