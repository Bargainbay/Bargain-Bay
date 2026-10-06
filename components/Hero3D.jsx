'use client';
import { useEffect, useRef, useState } from 'react';

// A real 3D model of the prize, in the homepage hero.
//
// The static photo is ALWAYS rendered and is what the page ships with: the 3D
// viewer is an upgrade that is fetched after the page is idle, and only when the
// device can take it. No WebGL, "reduce motion", or Data Saver on means the
// photo stays, and so does any failure to load the script or the model.
//
// The model was generated from the single front photo, so its back and sides are
// the AI's guess. The camera is therefore held to a window around the front
// (about +/-35 degrees) and the model sways inside it. Visitors can drag within
// that window but cannot swing round to the back.
const VIEWER = 'https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js';
const RANGE = 35;

export default function Hero3D({ poster, alt, glb }) {
  const [use3d, setUse3d] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const el = useRef(null);

  useEffect(() => {
    let dead = false;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const saveData = navigator.connection?.saveData;
    let gl = false;
    try { const c = document.createElement('canvas'); gl = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch {}
    if (reduce || saveData || !gl) return undefined;
    const go = () => {
      if (dead) return;
      if (customElements.get('model-viewer')) { setUse3d(true); return; }
      const s = document.createElement('script');
      s.type = 'module'; s.src = VIEWER;
      s.onload = () => !dead && setUse3d(true);
      document.head.appendChild(s);
    };
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 800));
    idle(go);
    return () => { dead = true; };
  }, []);

  // Sway, until the visitor touches it. Then it is theirs.
  useEffect(() => {
    const m = el.current;
    if (!use3d || !m) return undefined;
    let raf, t0 = performance.now(), touched = false;
    const onLoad = () => setLoaded(true);
    const stop = () => { touched = true; };
    m.addEventListener('load', onLoad);
    m.addEventListener('pointerdown', stop);
    const tick = (t) => {
      if (!touched) {
        const az = Math.sin((t - t0) / 1900) * (RANGE - 8);
        m.cameraOrbit = `${az}deg 84deg 82%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); m.removeEventListener('load', onLoad); m.removeEventListener('pointerdown', stop); };
  }, [use3d]);

  return (
    <div className="hero3d">
      <img src={poster} alt={alt} className="hero3d-poster" data-hidden={loaded ? '1' : '0'} />
      {use3d && (
        <model-viewer
          ref={el}
          src={glb}
          alt={alt}
          camera-controls
          disable-zoom
          disable-pan
          interaction-prompt="none"
          min-camera-orbit={`-${RANGE}deg 70deg auto`}
          max-camera-orbit={`${RANGE}deg 100deg auto`}
          camera-orbit="0deg 84deg 82%"
          field-of-view="24deg"
          shadow-intensity="1.1"
          shadow-softness="0.9"
          exposure="1.05"
          style={{ opacity: loaded ? 1 : 0 }}
        />
      )}
    </div>
  );
}
