'use client';
import { useState, useEffect, useRef } from 'react';

// The product photo viewer: one big image, a thumbnail strip, arrows, swipe.
//
// ORDER IS THE POINT. `images[0]` is always the manufacturer's stock photo and
// the real photographs of the machine come after it — the owner's rule, the same
// one `imageFor` follows for cards and the Meta feed. A wall of studio shots is
// what makes a listing page look like a shop; the photographs of the actual
// scratch are what close the sale, and they are one tap away instead of one
// scroll down.
//
// Each slide says which kind it is. On a one-of-a-kind used appliance "this is
// the actual unit" is the most valuable sentence on the page, and a buyer cannot
// tell a stock render from a warehouse photo of a clean machine without being
// told.
//
// Plain <img>, not next/image, deliberately. Stock photos come from a dozen
// manufacturer and retailer CDNs and data/images.json is meant to be editable
// without a deploy — next/image would need every one of those hosts named in
// next.config, and an unlisted host throws at runtime and takes the product page
// down. A gallery also needs the full-size file anyway the moment somebody opens
// a photo, so one download serves both the thumbnail and the large view.
export default function ProductGallery({ images = [], alt = '', badge = null }) {
  const [i, setI] = useState(0);
  const key = images.map((x) => x.url).join('|');
  // Switching units in the picker swaps the whole set — start again at the
  // stock photo rather than leaving the index pointing at another unit's scratch.
  useEffect(() => { setI(0); }, [key]);

  const touch = useRef(null);
  if (!images.length) return null;
  const n = images.length;
  const safe = Math.min(i, n - 1);
  const cur = images[safe];
  const go = (d) => setI((p) => (p + d + n) % n);

  return (
    <div>
      <div
        className="product-img"
        onTouchStart={(e) => { touch.current = e.changedTouches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touch.current == null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
        }}
      >
        {badge}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cur.url} alt={cur.kind === 'stock' ? alt : `${alt} — ${cur.label}`} />
        {n > 1 && (
          <>
            <button type="button" className="gal-arrow gal-prev" onClick={() => go(-1)} aria-label="Previous photo">‹</button>
            <button type="button" className="gal-arrow gal-next" onClick={() => go(1)} aria-label="Next photo">›</button>
            <span className="gal-count">{safe + 1} / {n}</span>
          </>
        )}
      </div>

      {/* The caption is load-bearing, not decoration — see the note above. */}
      <div className="gal-caption">
        {cur.kind === 'stock'
          ? 'Manufacturer photo — the same model, not this unit.'
          : cur.kind === 'rsops'
            ? `Photo of this exact unit — ${cur.label}, taken during inspection.`
            : 'Photo of this exact unit, taken at our warehouse.'}
      </div>

      {n > 1 && (
        <div className="gal-thumbs" role="tablist" aria-label="Photos">
          {images.map((im, idx) => (
            <button
              key={im.url}
              type="button"
              role="tab"
              aria-selected={idx === safe}
              aria-label={im.kind === 'stock' ? 'Manufacturer photo' : `Photo of this unit: ${im.label}`}
              className={'gal-thumb' + (idx === safe ? ' active' : '')}
              onClick={() => setI(idx)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
