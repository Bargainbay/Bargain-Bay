'use client';
import { useEffect, useRef } from 'react';

// Ambient motion behind the hero text: a short muted clip, looped.
//
// The clip is crossfaded into a second copy of itself just before it ends, so the
// loop has no visible jump even when the first and last frames differ. The
// section's own background image (the clip's first frame) is what is painted
// until the video is playing, so there is no flash and no layout shift.
//
// The clip is a few MB, so it is fetched ONCE, after the page has loaded and the
// browser is idle (never competing with the page itself), and both copies play
// from that single download. It does nothing, and the still image stays, for
// anyone who has asked for reduced motion, has Data Saver on, or is on anything
// slower than a 4G-class connection; and it pauses while the hero is off screen
// or the tab is hidden, so it costs nothing to somebody scrolling past it.
const FADE = 1.0;

export default function HeroVideo({ src }) {
  const a = useRef(null);
  const b = useRef(null);

  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const conn = navigator.connection;
    if (reduce || conn?.saveData || (conn?.effectiveType && conn.effectiveType !== '4g')) return undefined;
    const vids = [a.current, b.current];
    if (!vids[0] || !vids[1]) return undefined;

    let cur = 0, switching = false, raf = 0, visible = true, dead = false, objectUrl = '';
    let io, onVis;
    const first = vids[0];
    const play = (v) => { const p = v.play(); if (p?.catch) p.catch(() => {}); };
    const reveal = () => { first.style.opacity = '1'; };

    const tick = () => {
      if (dead) return;
      const v = vids[cur];
      if (visible && !switching && v.duration && v.currentTime > v.duration - FADE) {
        const n = vids[1 - cur];
        switching = true;
        n.currentTime = 0;
        play(n);
        n.style.opacity = '1';
        v.style.opacity = '0';
        setTimeout(() => { v.pause(); cur = 1 - cur; switching = false; }, FADE * 1000);
      }
      raf = requestAnimationFrame(tick);
    };

    const start = async () => {
      try {
        const res = await fetch(src);
        if (!res.ok || dead) return;
        objectUrl = URL.createObjectURL(await res.blob());
        if (dead) { URL.revokeObjectURL(objectUrl); return; }
        vids.forEach((v) => { v.src = objectUrl; });
        first.addEventListener('playing', reveal, { once: true });
        play(first);
        raf = requestAnimationFrame(tick);
        io = new IntersectionObserver(([e]) => {
          visible = e.isIntersecting;
          const v = vids[cur];
          if (visible) play(v); else v.pause();
        });
        io.observe(first.parentElement);
        onVis = () => { if (document.hidden) vids[cur].pause(); else if (visible) play(vids[cur]); };
        document.addEventListener('visibilitychange', onVis);
      } catch { /* the still image stays */ }
    };
    // After the page itself has finished loading, then when the browser is idle.
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 600));
    const go = () => idle(start);
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });

    return () => {
      dead = true; cancelAnimationFrame(raf); io?.disconnect();
      window.removeEventListener('load', go);
      if (onVis) document.removeEventListener('visibilitychange', onVis);
      first.removeEventListener('playing', reveal);
      vids.forEach((v) => v.pause());
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  return (
    <div className="hero-vid-wrap" aria-hidden="true">
      <video ref={a} className="hero-vid" muted playsInline preload="none" />
      <video ref={b} className="hero-vid" muted playsInline preload="none" />
    </div>
  );
}
