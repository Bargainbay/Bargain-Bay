'use client';
import { useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';

// The Google review card, replaced by the phone that is already in the driver's
// hand. A card is one more thing to carry, one more thing to run out of, and one
// more thing to leave in the other van.
//
// **Generated on the phone, not fetched.** A QR that arrives as an image from a
// server is a QR that doesn't exist in a basement, on a rural road, or in the
// thirty seconds a customer is willing to stand there — which is most of the
// doorsteps this is for. The encoder runs locally and needs no network at all.
export default function ReviewQr({ url, onClose, onAsked }) {
  const box = useRef(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!url || !box.current) return;
    try {
      // Type 0 = pick the smallest version that fits. 'M' correction survives a
      // fingerprint on the screen and a phone held at an angle; 'L' would make a
      // slightly coarser code that fails more often in exactly those conditions.
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      // createSvgTag scales to the container; an SVG stays sharp on any screen
      // and, unlike a canvas, survives the browser re-rendering it at a
      // different size when the phone rotates.
      box.current.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
      const svg = box.current.querySelector('svg');
      if (svg) { svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); }
    } catch (e) {
      setErr(e?.message || 'Could not make the code.');
    }
  }, [url]);

  // Keep the screen awake and bright while somebody is pointing a camera at it.
  // A screen that dims mid-scan is the single most likely way this fails.
  useEffect(() => {
    let lock = null;
    navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    return () => { try { lock?.release(); } catch { /* already gone */ } };
  }, []);

  // Asking is the thing worth recording — not whether they left one, which
  // Google never tells us. "We asked on 12 of 15 deliveries" is a question the
  // office can act on; "we got 3 reviews" is not.
  useEffect(() => { onAsked?.(); }, [onAsked]);

  return (
    <div className="drv-qr" role="dialog" aria-label="Google review code">
      <div className="drv-qr-head">Scan for a Google review</div>
      <div className="drv-qr-code" ref={box} />
      {err && <div className="error-box">{err}</div>}
      <p className="drv-qr-sub">
        Point the camera at it — it opens our Google page. Thank you for choosing us.
      </p>
      {/* If the customer's camera won't play, the driver can open it and hand
          the phone over, or read the address out. */}
      <a className="drv-btn" href={url} target="_blank" rel="noopener noreferrer">Open the page instead</a>
      <button type="button" className="drv-btn go" onClick={onClose}>Done</button>
    </div>
  );
}
