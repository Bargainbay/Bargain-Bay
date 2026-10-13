// "Save this picture": any route that streams an image adds these headers when
// the request carries ?download=1, so the browser SAVES the file instead of
// showing it. The name is what the picture is of, never a blob id.
export function downloadHeaders(req, label, contentType = 'image/jpeg') {
  let want = false;
  try { want = new URL(req.url).searchParams.get('download') === '1'; } catch { /* no url */ }
  if (!want) return {};
  const ext = /png/i.test(contentType) ? 'png' : /webp/i.test(contentType) ? 'webp' : 'jpg';
  const safe = String(label || 'photo').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'photo';
  return { 'Content-Disposition': `attachment; filename="${safe}.${ext}"` };
}
