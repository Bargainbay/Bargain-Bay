// Turning what a phone hands back into something that will survive the upload.
// Shared by the close-out sheet and the add-photos-later sheet, because getting
// this wrong once already cost a delivery its proof.

// Decoding a photo off a phone, the long way round on purpose. An iPhone hands
// back HEIC from the library, and createImageBitmap refuses it on iOS versions
// that will happily render the same file in an <img>. Trying only the fast path
// is why a driver's photos silently vanished.
async function decode(file) {
  try {
    const bmp = await createImageBitmap(file);
    return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close?.() };
  } catch { /* fall through to the <img> path */ }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise((ok, no) => {
    img.onload = ok;
    img.onerror = () => no(new Error("that photo couldn't be read"));
    img.src = url;
  });
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

// Phone photos are several megabytes each; a stop with six of them would not
// survive a serverless body limit, let alone a rural upload. If any step of the
// shrink fails we send the ORIGINAL rather than nothing — a 4MB photo that
// arrives beats a tidy one that doesn't.
export async function compress(file) {
  const { src, w, h, done } = await decode(file);
  try {
    const max = 1400;
    let width = w, height = h;
    if (!width || !height) return file;
    if (width > max || height > max) {
      const s = Math.min(max / width, max / height);
      width = Math.round(width * s); height = Math.round(height * s);
    }
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    c.getContext('2d').drawImage(src, 0, 0, width, height);
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.72));
    return out || file;
  } finally {
    done();
  }
}

// A whole selection at once. Failures are COUNTED, not swallowed: a driver who
// taps, sees nothing appear and no error, concludes the app can't do photos.
export async function compressPhotos(files) {
  const ok = [];
  let failed = 0;
  for (const f of files) {
    try { ok.push({ blob: await compress(f), url: URL.createObjectURL(f) }); }
    catch { failed += 1; }
  }
  return { ok, failed };
}
