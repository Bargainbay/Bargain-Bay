// Where to go after a successful second-factor check: only a page inside the vendor portal.
// No imports — the sign-in components (browser) and the pages (server) both use it. Anything
// else, including "//evil.example" and absolute URLs, falls back to the portal home.
export const safeNext = (n) =>
  (typeof n === 'string' && /^\/vendor(\/[\w\-./]*)?(\?[\w=&%\-.]*)?$/.test(n) && !n.includes('..') ? n : '/vendor');
