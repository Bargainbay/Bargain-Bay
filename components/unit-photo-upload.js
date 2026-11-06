// Sending a unit's photos to /api/admin/unit-photos, ONE PER REQUEST.
//
// A serverless function takes a request body of about 4.5MB. Two raw phone
// photos (2.8MB + 3.0MB, 2026-11-04) came to more than that, the platform
// answered with an HTML "Request Entity Too Large" page, and the screen tried to
// read it as JSON and showed gibberish. One photo per request cannot hit that
// limit, and a failure on one picture no longer costs the others.
//
// Returns { saved, failed, error } where `error` is the first reason given, in
// words a person can act on. It never throws on a bad response.
export async function postUnitPhotos(sku, blobs, nameOf = (i) => `${sku}-${i + 1}.jpg`) {
  let saved = 0, failed = 0, error = '';
  for (const [i, blob] of blobs.entries()) {
    try {
      const fd = new FormData();
      fd.set('sku', sku);
      fd.append('photos', blob, nameOf(i));
      const r = await fetch('/api/admin/unit-photos', { method: 'POST', body: fd });
      const text = await r.text();
      let d = {};
      try { d = JSON.parse(text); } catch { /* an HTML error page */ }
      if (r.ok && d.photos?.length) { saved += d.photos.length; failed += d.failed || 0; continue; }
      failed += 1;
      if (!error) {
        error = d.error
          || (r.status === 413 ? 'That photo is too big to send.' : `The server said ${r.status}.`);
      }
    } catch {
      failed += 1;
      if (!error) error = 'No connection. Check the signal and try again.';
    }
  }
  return { saved, failed, error };
}
