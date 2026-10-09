// A stand-in for `next/headers`, used ONLY by the test runner.
//
// lib/auth.js imports it for `cookies()`, which getSession() needs. Plain Node
// cannot resolve Next's server-only export map, so importing lib/auth in a test
// fails before any test runs — even for isAdmin/isSales, which take a session
// object and never touch a cookie.
//
// Everything here THROWS rather than returning something plausible. A stub that
// quietly returns an empty cookie jar would let a test think it had exercised
// getSession() when it had exercised the stub.
const nope = (name) => () => {
  throw new Error(
    `next/headers ${name}() is stubbed in tests. Anything that reads a real request `
    + 'belongs in an integration test, not here.'
  );
};

// The ONE opt-in: a test that has deliberately set a cookie jar gets it back from
// cookies(), so a route handler can be called as somebody. With no jar set this
// still throws exactly as before, so a test cannot get an empty jar by accident.
let jar = null;
export function __setTestCookies(obj) { jar = obj ? { ...obj } : null; }
export const cookies = async () => {
  if (!jar) nope('cookies')();
  return { get: (name) => (name in jar ? { name, value: jar[name] } : undefined), getAll: () => Object.entries(jar).map(([name, value]) => ({ name, value })), has: (name) => name in jar };
};
export const headers = nope('headers');
export const draftMode = nope('draftMode');
