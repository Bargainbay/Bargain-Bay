'use client';
import { useEffect, useRef, useState } from 'react';

// Live camera scanning for our own QR labels.
//
// A live feed, not "take a photo then decode": putting a skid away is twenty
// stickers in a row, and a shutter press per sticker is how people stop scanning.
//
// BarcodeDetector where the browser has one (Android Chrome); jsQR everywhere
// else, because iPhone Safari has none and the warehouse phones are whatever
// people carry. Loaded only when needed.
//
// The same label read on consecutive frames fires ONCE, and keeps not firing for
// as long as it stays in view — a camera held on a sticker is one scan, not
// thirty moves.
//
// getUserMedia needs https (or localhost). Anywhere it can't open, the scan box
// above it still takes typing and handheld scanners.
export default function QrScanner({ onScan }) {
  const video = useRef(null);
  const handler = useRef(onScan);
  const [err, setErr] = useState('');
  const [hit, setHit] = useState(false);

  useEffect(() => { handler.current = onScan; }, [onScan]);

  useEffect(() => {
    let stream = null;
    let stopped = false;
    let timer = null;
    let flash = null;
    const last = { text: '', at: 0 };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('This browser can’t open the camera here — type the code, or use a handheld scanner.');
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current;
        v.srcObject = stream;
        await v.play();

        let detector = null;
        const Detector = window.BarcodeDetector;
        if (Detector) {
          try {
            if ((await Detector.getSupportedFormats()).includes('qr_code')) detector = new Detector({ formats: ['qr_code'] });
          } catch { /* fall back to jsQR */ }
        }
        const jsQR = detector ? null : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const tick = async () => {
          if (stopped) return;
          try {
            if (v.readyState >= 2 && v.videoWidth) {
              let text = null;
              if (detector) {
                text = (await detector.detect(v))[0]?.rawValue || null;
              } else {
                // 640px on the long side reads a sticker at arm's length and
                // keeps an older phone from cooking itself.
                const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
                canvas.width = Math.round(v.videoWidth * scale);
                canvas.height = Math.round(v.videoHeight * scale);
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null;
              }
              if (text) {
                const now = Date.now();
                if (text !== last.text || now - last.at > 2500) {
                  navigator.vibrate?.(60);
                  setHit(true);
                  clearTimeout(flash);
                  flash = setTimeout(() => setHit(false), 350);
                  handler.current?.(text);
                }
                last.text = text;
                last.at = now;
              }
            }
          } catch { /* one bad frame is not a reason to stop reading */ }
          timer = setTimeout(tick, 180);
        };
        tick();
      } catch (e) {
        setErr(e?.name === 'NotAllowedError'
          ? 'Camera permission was refused — allow it for this site in the browser settings, or type the code.'
          : (e?.message || 'Could not open the camera.'));
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(flash);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (err) return <div className="error-box">{err}</div>;
  return (
    <div className={'wh-cam' + (hit ? ' is-hit' : '')}>
      <video ref={video} muted playsInline />
      <div className="wh-cam-aim" aria-hidden="true" />
    </div>
  );
}
