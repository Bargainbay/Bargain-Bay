import fs from 'node:fs';
import path from 'node:path';
import { getSession, isAdmin } from '../../../../lib/auth';
import { hasDb } from '../../../../lib/db';
import { getPartner, getPartnerSeat } from '../../../../lib/referral-partners';

export const dynamic = 'force-dynamic';

// The partner tutorial videos. They are NOT in /public: the managers' one states the organisation's pay terms, so both are served
// only to a signed-in partner seat (or our own admin). Managers (organisation admins) may watch either video; a lead generator
// only their own. Supports Range requests so a phone can seek.
const FILES = { managers: 'partner-tutorial-managers.mp4', generators: 'partner-tutorial-generators.mp4' };

export async function GET(req) {
  const v = new URL(req.url).searchParams.get('v') || '';
  const file = FILES[v];
  if (!file) return new Response('Not found', { status: 404 });
  const session = await getSession();
  if (!session) return new Response('Sign in first', { status: 401 });
  let allowed = isAdmin(session);
  if (!allowed && hasDb()) {
    const org = await getPartner(session.email);                       // an organisation login (main or admin teammate)
    const seat = org ? null : await getPartnerSeat(session.email);     // a lead generator
    allowed = v === 'managers' ? !!org : !!(org || seat);
  }
  if (!allowed) return new Response('Not found', { status: 404 });
  const full = path.join(process.cwd(), 'private-media', file);
  let size;
  try { size = fs.statSync(full).size; } catch { return new Response('Not found', { status: 404 }); }
  const headers = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Robots-Tag': 'noindex' };
  const range = req.headers.get('range');
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10));
    let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
    end = Math.min(end, size - 1);
    if (!(start <= end) || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    const buf = fs.readFileSync(full).subarray(start, end + 1);
    return new Response(buf, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(buf.length) } });
  }
  return new Response(fs.readFileSync(full), { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
}
