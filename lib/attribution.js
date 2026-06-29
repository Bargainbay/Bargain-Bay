// First-touch marketing attribution. A client cookie (bb_attr) captures the
// landing utm_source/campaign + referrer; checkout reads it and stamps the order
// so the Marketing dashboard can show revenue (and ROAS) by channel.
import { query, hasDb } from './db';

export const ATTR_COOKIE = 'bb_attr';

// Normalise a utm_source / referrer into a channel label.
export function classifyChannel({ utmSource, referrer } = {}) {
  const s = (utmSource || '').toLowerCase();
  if (s) {
    if (/face|insta|meta|\bfb\b|ig/.test(s)) return 'Meta';
    if (/google|goog|gad|gclid/.test(s)) return 'Google';
    if (/kijiji/.test(s)) return 'Kijiji';
    if (/email|klaviyo|resend|newsletter/.test(s)) return 'Email';
    if (/tiktok/.test(s)) return 'TikTok';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const r = (referrer || '').toLowerCase();
  if (!r) return 'Direct';
  if (/facebook|instagram|fb\.com|fbclid|\.fb\b/.test(r)) return 'Meta';
  if (/google\./.test(r)) return 'Google';
  if (/kijiji/.test(r)) return 'Kijiji';
  if (/tiktok/.test(r)) return 'TikTok';
  if (/bing|yahoo|duckduck|ecosia/.test(r)) return 'Search';
  if (/bargainbay\.ca/.test(r)) return 'Direct';
  return 'Referral';
}

let ensured = null;
export async function ensureAttributionColumns() {
  if (!hasDb()) return;
  if (ensured) return ensured;
  ensured = Promise.all([
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS source text'),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_campaign text'),
    query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS referrer text')
  ]).catch((e) => { ensured = null; throw e; });
  return ensured;
}

// Read the first-touch cookie from a Next request → { source, campaign, referrer }.
export function readAttribution(req) {
  try {
    const raw = req.cookies?.get?.(ATTR_COOKIE)?.value;
    if (!raw) return { source: 'Direct', campaign: null, referrer: null };
    const a = JSON.parse(decodeURIComponent(raw));
    return {
      source: classifyChannel({ utmSource: a.us, referrer: a.r }),
      campaign: a.uc || null,
      referrer: a.r ? String(a.r).slice(0, 300) : null
    };
  } catch {
    return { source: 'Direct', campaign: null, referrer: null };
  }
}
