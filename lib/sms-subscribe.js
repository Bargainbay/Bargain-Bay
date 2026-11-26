// Joining the deal-text list. Marketing texts need an EXPRESS yes (lib/consent), so this is the only way a
// customer gets onto it from the website. The wording stored is ours, never the browser's.
import { query, hasDb } from './db';
import { grantConsent, consentStatus } from './consent';
import { SMS_CONSENT_TEXT } from './consent-text';
import { upsertCustomer } from './customers';
import { phoneKey } from './constants';

// A Canadian / US mobile: +1 and ten digits, area code and exchange not starting 0 or 1.
export const textableNumber = (phone) => {
  const k = phoneKey(phone);
  return k && /^\+1[2-9]\d{2}[2-9]\d{6}$/.test(k) ? k : null;
};

/**
 * Record the yes. `where` says which screen they were on. A number that has opted out (STOP) is NOT turned
 * back on from a web form - anyone can type anyone's number; they have to text START themselves.
 * `ensureCustomer: false` for callers that already save the customer (so it isn't created twice).
 */
export async function subscribeToTexts({ phone, name, where, source = 'website', ip, ensureCustomer = true } = {}) {
  const key = textableNumber(phone);
  if (!key) return { ok: false, error: 'Enter a 10-digit mobile number.' };
  if (!hasDb()) return { ok: false, error: 'Signing up is briefly unavailable. Please try again soon.' };
  const state = (await consentStatus([key], 'sms')).get(key);
  if (state?.basis === 'withdrawn') return { ok: true, subscribed: false };
  if (state?.basis !== 'express') {
    await grantConsent({ channel: 'sms', phone: key, source, ip, evidence: `${SMS_CONSENT_TEXT} (opted in on ${where || 'the website'})` });
  }
  // Campaigns are sent to the customer database, so a number with no record would never be texted.
  if (ensureCustomer) {
    const { rows } = await query('SELECT 1 FROM customers WHERE phone_key = $1 LIMIT 1', [key]).catch(() => ({ rows: [] }));
    if (!rows.length) await upsertCustomer({ phone, name });
  }
  return { ok: true, subscribed: true };
}
