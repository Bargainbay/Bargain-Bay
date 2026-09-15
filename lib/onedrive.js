// CDA's delivery workbook, read out of OneDrive.
//
// Canadian Discount Appliances do not email their work. They keep a shared
// Microsoft workbook — "RS Solutions Delivery" — and edit it in place, which
// means nobody at RS Solutions is TOLD anything: rows appear, and somebody has
// to remember to go and look. Every other client's work arrives as mail and
// stages itself; this one was invisible.
//
// WHY THIS NEEDS OAUTH AT ALL, since the sharing email says "this link will work
// for anyone": it no longer does. The share has been migrated to SharePoint
// (`migratedtospo=true` on the redirect), and the chain now ends at a login page
// — an anonymous fetch gets 403, and OneDrive's public `shares/u!<base64>` API
// gets 401. Verified 2026-09-11. So the file is read as an identity that has
// been granted it, which is the dispatch desk's own Microsoft account.
//
// It reads and never writes. The workbook belongs to the client; a bug here must
// not be able to edit their spreadsheet.
import { getSetting, setSetting } from './settings';
import { brandFor } from './brands';

const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GRAPH = 'https://graph.microsoft.com/v1.0';

// `offline_access` is what returns a refresh token — without it the connection
// dies the first time the access token expires, an hour later, and looks like a
// bug on a Tuesday. `Files.Read.All` is the narrowest scope Microsoft offers
// that can read a file somebody else shared with you; there is no per-file
// scope, which is exactly why this should be a dedicated account and not
// anybody's personal Microsoft login.
const SCOPES = 'offline_access Files.Read.All User.Read';

export function oneDriveConfigured() {
  return !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

// THE RS HOST, not the storefront. The connect button is on the dispatch page,
// which lives on dispatch.rssolutions.ca, and **a session cookie here is
// host-only** — send Microsoft back to bargainbay.ca and the callback sees no
// session at all and answers "Not authorized", after the owner has already
// signed in and consented. Same rule as the import-call webhook: the RS host is
// taken from the BRAND and never from the incoming request.
//
// Whatever this returns has to match the redirect URI registered on the
// Microsoft app EXACTLY, so changing it means editing the registration too.
export function oneDriveRedirectUri() {
  return `${brandFor('rs_solutions').url()}/api/admin/onedrive/callback`;
}

export function oneDriveAuthUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: oneDriveRedirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    state
  });
  return `${AUTH}?${p}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      redirect_uri: oneDriveRedirectUri(),
      ...body
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || `Microsoft refused that (${res.status}).`);
  return data;
}

// Store the refresh token, and the access token with its expiry so ordinary
// reads don't round-trip to Microsoft every time. Microsoft ROTATES the refresh
// token on every use, so whatever came back replaces what we had — keeping the
// old one is how a connection dies quietly a fortnight later.
async function saveTokens(t) {
  const prev = (await getSetting('onedrive_tokens', null)) || {};
  await setSetting('onedrive_tokens', {
    refreshToken: t.refresh_token || prev.refreshToken || null,
    accessToken: t.access_token || null,
    expiresAt: t.expires_in ? Date.now() + (t.expires_in - 60) * 1000 : 0,
    connectedAt: prev.connectedAt || new Date().toISOString()
  });
}

export async function oneDriveExchangeCode(code) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code });
  await saveTokens(t);
  // Record WHICH account authorised it. "Connected" with no name is impossible
  // to audit later, and this grant reads every file that account can see.
  try {
    const me = await fetch(`${GRAPH}/me`, { headers: { authorization: `Bearer ${t.access_token}` } });
    const who = await me.json();
    if (who?.userPrincipalName || who?.mail) {
      await setSetting('onedrive_account', who.userPrincipalName || who.mail);
    }
  } catch { /* the connection is good either way */ }
  return true;
}

async function accessToken() {
  const t = await getSetting('onedrive_tokens', null);
  if (!t?.refreshToken) throw new Error('OneDrive is not connected yet.');
  if (t.accessToken && t.expiresAt > Date.now()) return t.accessToken;
  const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken });
  await saveTokens(fresh);
  return fresh.access_token;
}

export async function oneDriveStatus() {
  const t = await getSetting('onedrive_tokens', null).catch(() => null);
  return {
    configured: oneDriveConfigured(),
    connected: !!t?.refreshToken,
    account: await getSetting('onedrive_account', null).catch(() => null),
    connectedAt: t?.connectedAt || null,
    fileId: await getSetting('cda_file_id', null).catch(() => null),
    driveId: await getSetting('cda_drive_id', null).catch(() => null),
    fileName: await getSetting('cda_file_name', null).catch(() => null),
    shareUrl: await getSetting('cda_share_url', null).catch(() => null),
    lastRead: await getSetting('cda_last_read', null).catch(() => null)
  };
}

export async function oneDriveDisconnect() {
  await setSetting('onedrive_tokens', null);
  await setSetting('onedrive_account', null);
}

async function graph(path, { raw = false } = {}) {
  const token = await accessToken();
  const res = await fetch(`${GRAPH}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // The STATUS rides along, because callers have to be able to tell "that
    // item is not there" from "the connection is dead". Re-resolving a link on
    // an expired grant would just fail twice and report the second failure.
    const e = new Error(err?.error?.message || `Microsoft refused that (${res.status}).`);
    e.status = res.status;
    throw e;
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}

// ── The share LINK, which is what we were actually given ────────────────────
//
// The ids in a OneDrive share URL are NOT the ids Graph wants. That is written
// on the route that stores them, and it is why choosing the workbook started
// life as a picker. But the picker reads `/me/drive/sharedWithMe`, which needs
// the signed-in account to own a OneDrive of its own — the dispatch desk's does
// not, and buying it a licence so it can read somebody else's spreadsheet is
// the wrong shape of fix.
//
// Graph will do the conversion itself. `/shares/u!<token>/driveItem` takes the
// sharing URL and hands back the canonical item id and the drive it lives on:
// the documented route for exactly this case, a link somebody emailed us.
// CLAUDE.md's note that this API answers 401 was about an ANONYMOUS call, made
// before there was a connection to make it with; as an identity that has been
// granted the file, it is the supported path.
//
// The LINK is the source of truth and the ids are a cache. Resolving on every
// poll would be a round trip we do not need, and ids that stop working get
// resolved again rather than becoming somebody's Tuesday.
export function shareToken(url) {
  // Microsoft's own encoding: base64 of the URL, padding stripped, made
  // URL-safe, prefixed `u!`.
  const b64 = Buffer.from(String(url || ''), 'utf8').toString('base64');
  return `u!${b64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
}

export async function resolveSharedLink(url) {
  if (!String(url || '').trim()) throw new Error('There is no share link to resolve.');
  const d = await graph(`/shares/${shareToken(url)}/driveItem?$select=id,name,parentReference`);
  if (!d?.id) throw new Error('Microsoft did not name a file behind that link.');
  return { fileId: d.id, driveId: d.parentReference?.driveId || null, name: d.name || null };
}

// Store the link, and resolve it NOW when we can — a bad link should be a
// message on the screen of whoever pasted it, not a quiet failure three hours
// later on the schedule. Not being connected yet is NOT an error: the link is
// kept either way and the first read resolves it.
export async function setCdaShareLink(url) {
  const link = String(url || '').trim() || null;
  await setSetting('cda_share_url', link);
  if (!link) return { link: null };
  try {
    const r = await resolveSharedLink(link);
    await rememberResolved(r);
    return { link, ...r };
  } catch (e) {
    return { link, resolveError: e.message };
  }
}

async function rememberResolved(r) {
  await setSetting('cda_file_id', r.fileId);
  await setSetting('cda_drive_id', r.driveId);
  if (r.name) await setSetting('cda_file_name', r.name);
}

// Everything shared with this account. Used once, to find the workbook without
// anybody copying an id out of a URL — the ids in a OneDrive share link are not
// the ids Graph wants, which is a half hour nobody should have to spend.
export async function listShared() {
  const d = await graph('/me/drive/sharedWithMe');
  return (d.value || []).map((f) => ({
    id: f.remoteItem?.id || f.id,
    driveId: f.remoteItem?.parentReference?.driveId || null,
    name: f.name,
    modified: f.lastModifiedDateTime || null,
    by: f.remoteItem?.shared?.owner?.user?.displayName || null
  }));
}

// The workbook, as bytes. Graph's own workbook API needs the file to be in a
// drive the caller owns; a file shared FROM another tenant is far more reliably
// read by downloading it and parsing it the way every other client's sheet is
// parsed — which also means one xlsx code path, not two.
export async function downloadCdaWorkbook() {
  let fileId = await getSetting('cda_file_id', null);
  let driveId = await getSetting('cda_drive_id', null);
  const link = await getSetting('cda_share_url', null);
  if (!fileId && !link) throw new Error('No CDA workbook is chosen yet.');

  const fetchIt = () => graph(
    driveId
      ? `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(fileId)}/content`
      : `/me/drive/items/${encodeURIComponent(fileId)}/content`,
    { raw: true }
  );

  let buf;
  if (!fileId) {
    // Only a link so far — the ordinary first read after somebody pastes one.
    const r = await resolveSharedLink(link);
    await rememberResolved(r);
    ({ fileId, driveId } = r);
    buf = await fetchIt();
  } else {
    try {
      buf = await fetchIt();
    } catch (e) {
      // An id that Graph will not accept: the file was moved or re-shared, or
      // the pair was read off a share URL and was never what Graph wanted.
      // Ask the link again, ONCE, and only for that kind of refusal — retrying
      // a dead grant or a Microsoft outage would just fail twice and report the
      // wrong reason.
      const wrongItem = e?.status === 400 || e?.status === 404;
      if (!link || !wrongItem) throw e;
      const r = await resolveSharedLink(link);
      await rememberResolved(r);
      ({ fileId, driveId } = r);
      buf = await fetchIt();
    }
  }
  await setSetting('cda_last_read', new Date().toISOString()).catch(() => {});
  return buf;
}

export async function setCdaFile({ fileId, driveId, name }) {
  await setSetting('cda_file_id', String(fileId || '').trim() || null);
  await setSetting('cda_drive_id', String(driveId || '').trim() || null);
  await setSetting('cda_file_name', String(name || '').trim() || null);
}
