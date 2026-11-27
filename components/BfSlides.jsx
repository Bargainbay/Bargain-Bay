'use client';
// The Black Friday slideshow. One banner per doorbuster; a unit that sold keeps its slide with a SOLD OUT stamp.
// Autoplay pauses on hover/focus/touch and is off entirely for people who ask for reduced motion.
import { useEffect, useRef, useState } from 'react';
import { money } from '../lib/constants';

const MS = 6500;

export default function BfSlides({ slides, start = 0, ctaHref = '/deals', gone = 0 }) {
  const [i, setI] = useState(start);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);
  const touch = useRef(null);
  const n = slides.length;

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (mq?.matches) setStill(true);
  }, []);
  useEffect(() => {
    if (paused || still || n < 2) return undefined;
    const t = setTimeout(() => setI((x) => (x + 1) % n), MS);
    return () => clearTimeout(t);
  }, [i, paused, still, n]);

  const go = (k) => setI(((k % n) + n) % n);
  const onTouchStart = (e) => { setPaused(true); touch.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - (touch.current ?? 0);
    if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
    touch.current = null; setPaused(false);
  };

  return (
    <div className="bfs" role="region" aria-roledescription="carousel" aria-label="Black Friday doorbusters"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') go(i + 1); if (e.key === 'ArrowLeft') go(i - 1); }}>
      <div className="bfs-track" style={{ transform: `translateX(-${i * 100}%)` }}>
        {slides.map((s, k) => (
          <div key={s.id + k} className={'bfs-slide' + (s.sold ? ' is-sold' : '')} aria-hidden={k !== i} role="group" aria-roledescription="slide" aria-label={`${k + 1} of ${n}`}>
            <a className="bfs-photo" href={s.sold ? ctaHref : `/product/${s.id}`} tabIndex={k === i ? 0 : -1}>
              {s.pct > 0 && <span className="bfh-ribbon">{s.pct}% off</span>}
              <img src={s.image} alt={s.title} loading={k === start ? 'eager' : 'lazy'} />
              {s.sold && <span className="bfs-stamp" aria-label="Sold out">Sold out</span>}
            </a>
            <div className="bfs-copy">
              <span className="bfs-lot">Doorbuster {s.n} of {n}</span>
              <span className="bfs-make">{s.make}{s.condition ? ` · ${s.condition}` : ''}</span>
              <h2 className="bfs-title">{s.title}</h2>
              {s.sold ? (
                <>
                  <p className="bfs-soldline">Sold out.</p>
                  <p className="bfs-sub">It was {money(s.price)} (retail {money(s.was)}). Somebody got it. The next doorbuster is one slide over.</p>
                  <a href={ctaHref} className="bfh-btn bfh-btn-ghost" tabIndex={k === i ? 0 : -1}>See what is still here</a>
                </>
              ) : (
                <>
                  {s.pct > 0 && <span className="bfs-off">{s.pct}% off retail</span>}
                  <span className="bfs-price">
                    {s.left > 1 && <em>from</em>}
                    <strong>{money(s.price)}</strong>
                    {s.was > s.price && <s>{money(s.was)}</s>}
                  </span>
                  {s.was > s.price && <span className="bfs-save">You save {money(s.was - s.price)}</span>}
                  {s.left > 1 && <span className="bfs-left">{s.left} available</span>}
                  <a href={`/product/${s.id}`} className="bfh-btn bfh-btn-gold" tabIndex={k === i ? 0 : -1}>Grab this one</a>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {n > 1 && (
        <>
          <button type="button" className="bfs-arrow bfs-prev" aria-label="Previous deal" onClick={() => go(i - 1)}>‹</button>
          <button type="button" className="bfs-arrow bfs-next" aria-label="Next deal" onClick={() => go(i + 1)}>›</button>
          <div className="bfs-foot">
            <div className="bfs-dots">
              {slides.map((s, k) => (
                <button key={k} type="button" className={'bfs-dot' + (k === i ? ' on' : '') + (s.sold ? ' sold' : '')}
                  aria-label={`Deal ${k + 1}${s.sold ? ', sold out' : ''}`} aria-current={k === i} onClick={() => go(k)} />
              ))}
            </div>
            <span className="bfs-tally">{gone > 0 ? <><b>{gone} of {n}</b> already gone</> : `${n} doorbusters, one unit each`}</span>
          </div>
        </>
      )}
    </div>
  );
}
