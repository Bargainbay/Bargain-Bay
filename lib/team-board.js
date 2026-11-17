// The team board: chat and a post board in General, Sales, Warehouse and Delivery.
//
// - IDENTITY AND GROUPS COME FROM THE SIGN-IN, never from the request body. The
//   author of a message is stamped here; nothing the browser sends can name one.
// - A POST is an important notice with a title that can be pinned and that people
//   tick "Got it" on; CHAT is the running conversation. Same table, `kind` apart.
// - Messages are never edited and never really deleted: removal sets deleted_at
//   (who said what is the first question when something was "promised").
// - Everything here fails CLOSED on access and soft on reads: a database blip
//   shows an empty board, never somebody else's channel.
import { query, hasDb } from './db';
import { isAdmin, isSales } from './auth';
import { isDriver } from './drivers';
import { isDispatcher } from './dispatchers';
import { employeeByEmail, employeeByRsOpsName } from './team-clock';
import {
  CHANNEL_IDS, MAX_BODY, MAX_TITLE, RATE_PER_MINUTE, rightsFor
} from './team-board-rules';

const clean = (s, n) => String(s ?? '').replace(/\r\n/g, '\n').trim().slice(0, n);

/** A signed-in person -> { key, name, groups, rights } or null. */
export async function memberFromSession(session) {
  if (!session?.userId || !hasDb()) return null;
  const groups = [];
  if (isAdmin(session)) groups.push('admin');
  if (isSales(session)) groups.push('staff');
  if (await isDriver(session)) groups.push('driver');
  if (await isDispatcher(session)) groups.push('dispatcher');
  try { if (session.email && await employeeByEmail(session.email)) groups.push('employee'); } catch { /* not an employee */ }
  const rights = rightsFor(groups);
  if (!Object.keys(rights).length) return null;
  return {
    key: `user:${session.userId}`,
    name: String(session.name || session.email || 'Someone').trim().slice(0, 60),
    groups, rights
  };
}

// RS Ops roles -> board groups. The key proves the request came from RS Ops and RS Ops
// decides who is who (PIN sign-in), exactly as for stock moves. A floor role (associate,
// cleaner, tech, QA) is General + Warehouse; an RS Ops sales or admin login is office
// staff here (all four channels), the same as a sales/admin login on Bargain Bay.
const RSOPS_OFFICE = new Set(['sales', 'admin']);

/**
 * An RS Ops crew member (arrives with RSOPS_INTAKE_KEY, a name and a role).
 *
 * ONE PERSON, ONE IDENTITY. Somebody who signs in on both apps must see the same
 * board AND their own messages as theirs. If the name matches exactly one active
 * RS Solutions employee whose email has an account here, they ARE that account
 * (`user:<id>`, the same key a Bargain Bay login gets), so "You", unread counts
 * and removing your own message agree on both doors. Otherwise they are
 * `rsops:<name>`. The match only ever picks the KEY and the display name; it
 * never lends them that account's groups. What they can see comes from the role
 * RS Ops sent, so a name that happens to match an admin gains nothing.
 */
export async function memberFromRsops(name, role) {
  const who = String(name || '').trim().slice(0, 60);
  if (!who || !hasDb()) return null;
  const office = RSOPS_OFFICE.has(String(role || '').trim().toLowerCase());
  const groups = office ? ['staff'] : ['rsops'];
  let key = `rsops:${who.toLowerCase()}`;
  let display = `${who} (RS Ops)`;
  try {
    const emp = await employeeByRsOpsName(who);
    if (emp?.email) {
      const { rows } = await query('SELECT id, name FROM users WHERE lower(email) = $1 LIMIT 1', [String(emp.email).toLowerCase()]);
      if (rows[0]) { key = `user:${rows[0].id}`; display = String(rows[0].name || who).trim().slice(0, 60); }
    }
  } catch { /* unmatched: stay an RS Ops name */ }
  return { key, name: display, groups, rights: rightsFor(groups) };
}

const shape = (r, ackedByMe) => ({
  id: Number(r.id), channel: r.channel, kind: r.kind, title: r.title || null, body: r.body,
  authorKey: r.author_key, authorName: r.author_name,
  pinned: !!r.pinned_at, createdAt: r.created_at,
  acks: r.acks == null ? 0 : Number(r.acks),
  ackedByMe: !!ackedByMe
});

/**
 * One page of a feed. Chat: oldest-first within the page (`after` for polling,
 * `before` for older history). Posts: pinned first, then newest.
 */
export async function listMessages(member, { channel, kind = 'chat', after = 0, before = 0, limit = 50 } = {}) {
  if (!member?.rights[channel]) return { ok: false, status: 403, error: 'Not your channel.' };
  const k = kind === 'post' ? 'post' : 'chat';
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
  try {
    const args = [channel, k, member.key];
    let where = 'm.channel = $1 AND m.kind = $2 AND m.deleted_at IS NULL';
    if (Number(after) > 0) { args.push(Number(after)); where += ` AND m.id > $${args.length}`; }
    if (Number(before) > 0) { args.push(Number(before)); where += ` AND m.id < $${args.length}`; }
    args.push(lim);
    const order = k === 'post' && !Number(after)
      ? 'ORDER BY (m.pinned_at IS NOT NULL) DESC, m.id DESC'
      : (Number(after) > 0 ? 'ORDER BY m.id ASC' : 'ORDER BY m.id DESC');
    const { rows } = await query(
      `SELECT m.*, (SELECT count(*) FROM team_post_acks a WHERE a.message_id = m.id) AS acks,
              EXISTS (SELECT 1 FROM team_post_acks a WHERE a.message_id = m.id AND a.member_key = $3) AS mine
         FROM team_messages m WHERE ${where} ${order} LIMIT $${args.length}`, args);
    let out = rows.map((r) => shape(r, r.mine));
    // Chat reads top-to-bottom; the newest page was fetched newest-first.
    if (k === 'chat' && !Number(after)) out = out.reverse();
    return { ok: true, messages: out };
  } catch {
    return { ok: true, messages: [] };
  }
}

export async function sendMessage(member, { channel, kind = 'chat', title, body } = {}) {
  const r = member?.rights[channel];
  if (!r) return { ok: false, status: 403, error: 'Not your channel.' };
  const k = kind === 'post' ? 'post' : 'chat';
  if (k === 'post' && !r.post) return { ok: false, status: 403, error: 'Only the office posts notices in this channel. Use the chat.' };
  const text = clean(body, MAX_BODY);
  const head = clean(title, MAX_TITLE);
  if (!text) return { ok: false, status: 400, error: 'Write something first.' };
  if (k === 'post' && !head) return { ok: false, status: 400, error: 'A post needs a title.' };
  try {
    const { rows: [n] } = await query(
      `SELECT count(*)::int AS n FROM team_messages WHERE author_key = $1 AND created_at > now() - interval '1 minute'`, [member.key]);
    if (n.n >= RATE_PER_MINUTE) return { ok: false, status: 429, error: 'Slow down a little.' };
    const { rows } = await query(
      `INSERT INTO team_messages (channel, kind, title, body, author_key, author_name)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [channel, k, k === 'post' ? head : null, text, member.key, member.name]);
    // Writing counts as having read up to it.
    await markRead(member, channel, k, Number(rows[0].id));
    return { ok: true, message: shape(rows[0], false) };
  } catch {
    return { ok: false, status: 500, error: 'Could not send that. Try again.' };
  }
}

/** Moves forward only. */
export async function markRead(member, channel, kind, upToId) {
  if (!member?.rights[channel]) return false;
  const k = kind === 'post' ? 'post' : 'chat';
  try {
    await query(
      `INSERT INTO team_reads (member_key, channel, kind, last_read_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (member_key, channel, kind)
       DO UPDATE SET last_read_id = GREATEST(team_reads.last_read_id, EXCLUDED.last_read_id), updated_at = now()`,
      [member.key, channel, k, Math.max(0, Number(upToId) || 0)]);
    return true;
  } catch { return false; }
}

/** Unread counts per channel and kind, for the badges. Own messages never count. */
export async function unreadSummary(member) {
  const out = {};
  for (const ch of CHANNEL_IDS) if (member?.rights[ch]) out[ch] = { chat: 0, post: 0, unackedPosts: 0 };
  const channels = Object.keys(out);
  if (!channels.length) return { channels: out, total: 0 };
  try {
    const { rows } = await query(
      `SELECT m.channel, m.kind, count(*)::int AS n
         FROM team_messages m
         LEFT JOIN team_reads r ON r.member_key = $1 AND r.channel = m.channel AND r.kind = m.kind
        WHERE m.deleted_at IS NULL AND m.channel = ANY($2) AND m.author_key <> $1
          AND m.id > COALESCE(r.last_read_id, 0)
        GROUP BY m.channel, m.kind`, [member.key, channels]);
    for (const r of rows) out[r.channel][r.kind] = r.n;
    const { rows: un } = await query(
      `SELECT m.channel, count(*)::int AS n FROM team_messages m
        WHERE m.kind = 'post' AND m.deleted_at IS NULL AND m.channel = ANY($2) AND m.author_key <> $1
          AND m.pinned_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM team_post_acks a WHERE a.message_id = m.id AND a.member_key = $1)
        GROUP BY m.channel`, [member.key, channels]);
    for (const r of un) out[r.channel].unackedPosts = r.n;
  } catch { /* badges are a courtesy */ }
  const total = Object.values(out).reduce((s, c) => s + c.chat + c.post, 0);
  return { channels: out, total };
}

async function loadMessage(id) {
  const { rows } = await query('SELECT * FROM team_messages WHERE id = $1 AND deleted_at IS NULL', [Number(id)]);
  return rows[0] || null;
}

export async function ackPost(member, id) {
  const m = await loadMessage(id).catch(() => null);
  if (!m || m.kind !== 'post' || !member?.rights[m.channel]) return { ok: false, status: 404, error: 'Not found.' };
  await query(
    `INSERT INTO team_post_acks (message_id, member_key, member_name) VALUES ($1,$2,$3)
     ON CONFLICT (message_id, member_key) DO NOTHING`, [m.id, member.key, member.name]);
  return { ok: true };
}

/** Who has said "Got it" — moderators only, so the office can chase the rest. */
export async function postAcks(member, id) {
  const m = await loadMessage(id).catch(() => null);
  if (!m || !member?.rights[m.channel]?.moderate) return { ok: false, status: 403, error: 'Not allowed.' };
  const { rows } = await query('SELECT member_name, at FROM team_post_acks WHERE message_id = $1 ORDER BY at', [m.id]);
  return { ok: true, acks: rows.map((r) => ({ name: r.member_name, at: r.at })) };
}

export async function setPinned(member, id, pinned) {
  const m = await loadMessage(id).catch(() => null);
  if (!m || m.kind !== 'post' || !member?.rights[m.channel]?.moderate) return { ok: false, status: 403, error: 'Not allowed.' };
  await query('UPDATE team_messages SET pinned_at = $2, pinned_by = $3 WHERE id = $1',
    [m.id, pinned ? new Date() : null, pinned ? member.name : null]);
  return { ok: true };
}

/** Author removes their own; a moderator removes anyone's. The row stays. */
export async function removeMessage(member, id) {
  const m = await loadMessage(id).catch(() => null);
  if (!m || !member?.rights[m.channel]) return { ok: false, status: 404, error: 'Not found.' };
  if (m.author_key !== member.key && !member.rights[m.channel].moderate) {
    return { ok: false, status: 403, error: 'You can only remove your own messages.' };
  }
  await query('UPDATE team_messages SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [m.id, member.name]);
  return { ok: true };
}

/** One entry point for both routes (web session and RS Ops key). */
export async function handleTeamRequest(member, { method, params, body }) {
  if (!member) return { status: 401, json: { error: 'Sign in first.' } };
  const reply = (r, extra = {}) => ({ status: r.ok ? 200 : (r.status || 400), json: r.ok ? { ok: true, ...extra } : { error: r.error } });
  if (method === 'GET') {
    if (params.summary) {
      return { status: 200, json: { me: { key: member.key, name: member.name }, rights: member.rights, ...(await unreadSummary(member)) } };
    }
    if (params.acks) { const r = await postAcks(member, params.acks); return reply(r, { acks: r.acks }); }
    const r = await listMessages(member, params);
    return reply(r, { messages: r.messages });
  }
  const b = body || {};
  switch (b.action) {
    case 'send': { const r = await sendMessage(member, b); return reply(r, { message: r.message }); }
    case 'read': return { status: 200, json: { ok: await markRead(member, b.channel, b.kind, b.upTo) } };
    case 'ack': return reply(await ackPost(member, b.id));
    case 'pin': return reply(await setPinned(member, b.id, !!b.pinned));
    case 'delete': return reply(await removeMessage(member, b.id));
    default: return { status: 400, json: { error: 'Unknown action.' } };
  }
}
