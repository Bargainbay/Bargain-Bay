import { cookies } from 'next/headers';
import { verifyClientToken } from './client-portal';
import { portalGate, portalCookieName } from './client-portal-auth';

// One question every portal page and API asks: may THIS request see THIS client?
//   'ok'             the link is genuine and the password was entered
//   'needs_password' genuine link, no valid password cookie yet
//   'no_password'    the office has not set a password: nobody gets in
//   'bad_link'       the link's token does not match the client
export async function portalAccess(clientId, token) {
  if (!verifyClientToken(clientId, token)) return 'bad_link';
  const jar = await cookies();
  return portalGate(clientId, jar.get(portalCookieName(clientId))?.value);
}
