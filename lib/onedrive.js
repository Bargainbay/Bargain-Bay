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
import { SITE_URL } from './site';

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

export function oneDriveRedirectUri() {
  return `${SITE_URL}/api/admin/onedrive/callback`;
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
    throw new Error(err?.error?.message || `Microsoft refused that (${res.status}).`);
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
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
  const fileId = await getSetting('cda_file_id', null);
  const driveId = await getSetting('cda_drive_id', null);
  if (!fileId) throw new Error('No CDA workbook is chosen yet.');
  const path = driveId
    ? `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(fileId)}/content`
    : `/me/drive/items/${encodeURIComponent(fileId)}/content`;
  const buf = await graph(path, { raw: true });
  await setSetting('cda_last_read', new Date().toISOString()).catch(() => {});
  return buf;
}

export async function setCdaFile({ fileId, driveId, name }) {
  await setSetting('cda_file_id', String(fileId || '').trim() || null);
  await setSetting('cda_drive_id', String(driveId || '').trim() || null);
  await setSetting('cda_file_name', String(name || '').trim() || null);
}
