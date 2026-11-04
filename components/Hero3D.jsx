'use client';
// The 3D product stage in the homepage promo hero (added 2026-11-04).
//
// Pure CSS 3D: no video, no WebGL, so it costs one PNG and no JavaScript beyond
// the pointer tilt below. The product is always the REAL cut-out photo of a unit
// we hold, never a generated picture of an appliance. `scene` picks the backdrop
// ('diwali' | 'blackfriday'); both are styled under .hero-3d in globals.css.
import { useRef } from 'react';

export default function Hero3D({ scene, image, alt, badge }) {
  const scn = useRef(null);
  // Tilt follows the pointer on a mouse; touch and reduced-motion get the
  // resting pose (the CSS animations are switched off for reduced-motion).
  const move = (e) => {
    if (e.pointerType !== 'mouse' || !scn.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    scn.current.style.transform = `rotateY(${x * 22}deg) rotateX(${-y * 12}deg)`;
  };
  const leave = () => { if (scn.current) scn.current.style.transform = ''; };
  return (
    <div className={`hero-3d hero-3d-${scene}`} onPointerMove={move} onPointerLeave={leave} aria-hidden={alt ? undefined : 'true'}>
      <div className="h3-scene" ref={scn}>
        <div className="h3-floor" />
        <span className="h3-spark" style={{ left: '14%', top: '20%' }} />
        <span className="h3-spark" style={{ left: '82%', top: '45%', animationDelay: '1.2s' }} />
        <span className="h3-spark" style={{ left: '26%', top: '58%', animationDelay: '2.1s' }} />
        {scene === 'diwali' && (<><span className="h3-diya" style={{ left: '7%' }} /><span className="h3-diya" style={{ right: '7%' }} /></>)}
        <img className="h3-refl" src={image} alt="" />
        <img className="h3-unit" src={image} alt={alt || ''} />
        {badge && (
          <div className="h3-tag"><small>{badge.top}</small><b>{badge.main}</b>{badge.bottom && <small>{badge.bottom}</small>}</div>
        )}
      </div>
    </div>
  );
}
