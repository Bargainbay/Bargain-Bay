// An in-memory stand-in for `@vercel/blob`, used ONLY by the test runner (BB_TEST_STUBS=1).
// put/get/del behave like the private store the routes use: what is put can be got, a missing path is
// null, and nothing ever leaves the process. __blobKeys lets a test see what is stored.
const store = new Map();
export async function put(path, body, opts = {}) {
  store.set(path, { body: Buffer.from(body), contentType: opts.contentType || 'application/octet-stream' });
  return { pathname: path, url: `memory://${path}` };
}
export async function get(path) {
  const o = store.get(path);
  if (!o) return null;
  return { statusCode: 200, stream: new Blob([o.body]).stream(), blob: { contentType: o.contentType } };
}
export async function del(path) { store.delete(path); }
export const __blobKeys = () => [...store.keys()];
export const __blobBytes = (path) => store.get(path)?.body || null;
export async function list({ prefix = '' } = {}) {
  return { blobs: [...store.keys()].filter((k) => k.startsWith(prefix)).map((pathname) => ({ pathname, size: store.get(pathname).body.length })), hasMore: false };
}
