// The daily Black Friday email. Switched on and off from /admin/campaigns; OFF until somebody does.
//
// Written to read like a note from a person, because that is the only lever there is on Gmail's
// Primary tab: no images, no buttons, no tables, one link, and an invitation to reply. Gmail still
// decides which tab it lands in. The CASL footer and the unsubscribe headers are added by
// sendEmailCampaign and stay — they are required, and removing them would trade a tab for spam.
//
// Every unit is one of a kind, so the list is built from LIVE stock at send time and never typed.
import { query } from './db';
import { getSetting, setSetting } from './settings';
import { getAvailable } from './inventory';
import { pickDoorbusters, inSale } from './bf-hero';
import { audience, sendEmailCampaign, campaignRecipients } from './campaigns';
import { torontoToday, money } from './constants';
import { SITE_URL } from './site';

export const BF_KEY = 'bf_daily';
export const BF_FIRST_DAY = '2026-11-26';
export const BF_LAST_DAY = '2026-11-30';
const PER_EMAIL = 5;

export async function getBfDaily() {
  const s = (await getSetting(BF_KEY, null)) || {};
  return {
    enabled: s.enabled === true,
    until: /^\d{4}-\d{2}-\d{2}$/.test(s.until || '') ? s.until : BF_LAST_DAY
  };
}

export async function saveBfDaily(input = {}) {
  const until = /^\d{4}-\d{2}-\d{2}$/.test(input.until || '') ? input.until : BF_LAST_DAY;
  const cfg = { enabled: input.enabled === true, until };
  await setSetting(BF_KEY, cfg);
  return cfg;
}

// Pure: units and a day in, subject + plain message out. null when there is nothing real to say.
export function composeBfEmail(units, day) {
  const marked = units.filter((u) => inSale(u) && /black friday/i.test(u.clearanceNote || ''));
  const pool = marked.length >= PER_EMAIL ? marked : units;
  const picks = pickDoorbusters(pool, PER_EMAIL * 4, { minRetail: 0, minOff: 1 });
  if (!picks.length) return null;
  // A different slice each day, so five days are not five copies of one email.
  const n = Math.max(0, Math.round((Date.parse(day) - Date.parse(BF_FIRST_DAY)) / 86400000));
  const start = (n * PER_EMAIL) % picks.length;
  const todays = [...picks.slice(start), ...picks.slice(0, start)].slice(0, PER_EMAIL);

  const lines = todays.map((p) => {
    const u = p.rep || p.unit || p;
    const name = [u.make, u.category].filter(Boolean).join(' ') || u.title;
    const was = u.compareAt > u.price ? ` (retail ${money(u.compareAt)})` : '';
    return `- ${name}${u.model ? ` ${u.model}` : ''}: ${money(u.price)}${was}`;
  });

  const subject = day === '2026-11-27' ? 'Today is Black Friday, here is what we still have'
    : day === '2026-11-30' ? 'Last day for our Black Friday prices'
      : `What is still here this ${new Date(`${day}T12:00:00Z`).toLocaleDateString('en-CA', { weekday: 'long', timeZone: 'UTC' })}`;

  const message = [
    'Hi,',
    '',
    'A quick note from us in Pickering. These were still available when this was sent, and we only have one of each:',
    '',
    ...lines,
    '',
    'Prices are before HST. Pick up at 1135 Squires Beach Rd (10am to 8pm), or ask us about delivery.',
    '',
    `All the Black Friday deals are here: ${SITE_URL}/black-friday`,
    '',
    'Looking for something in particular? Just reply and tell us the size and type.',
    '',
    'Thanks,',
    'The Bargain Bay team'
  ].join('\n');

  return { subject, message, count: todays.length };
}

export async function previewBfEmail(day = torontoToday()) {
  const d = day < BF_FIRST_DAY ? BF_FIRST_DAY : day;
  return composeBfEmail(await getAvailable(), d);
}

/** The scheduled send. Safe to run twice: one claim per day, and nobody already sent to is sent again. */
export async function sendDailyBfEmail({ today = torontoToday() } = {}) {
  const cfg = await getBfDaily();
  if (!cfg.enabled) return { ok: true, skipped: 'switched off' };
  if (today < BF_FIRST_DAY || today > cfg.until) return { ok: true, skipped: 'outside the dates' };

  const email = composeBfEmail(await getAvailable(), today);
  if (!email) return { ok: true, skipped: 'nothing in stock to feature' };

  const claim = `bf_daily_sent:${today}`;
  const { rows } = await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, 'true'::jsonb, now()) ON CONFLICT (key) DO NOTHING RETURNING key`, [claim]);
  if (!rows.length) return { ok: true, skipped: 'already sent today' };

  const campaignKey = `bf-daily-${today}`;
  try {
    const done = (await campaignRecipients(campaignKey)).filter((r) => r.status === 'sent').map((r) => r.email);
    const result = await sendEmailCampaign({
      recipients: await audience('all'), subject: email.subject, message: email.message,
      segment: 'all', skip: done, campaignKey
    });
    const ok = !result.consentError && result.failed <= result.sent;
    if (!ok) await query('DELETE FROM settings WHERE key = $1', [claim]);
    return { ok, error: result.consentError || (ok ? null : `${result.failed} failed`), sent: result.sent, failed: result.failed };
  } catch (e) {
    await query('DELETE FROM settings WHERE key = $1', [claim]).catch(() => {});
    throw e;
  }
}
