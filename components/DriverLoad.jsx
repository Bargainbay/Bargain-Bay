'use client';
// The loading checklist: every item going on the van, with a picture of it,
// ticked off one at a time. Written for somebody who does not know appliance
// model numbers: the kind of machine and the picture come first, the numbers are
// there to check against the sticker.

const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : '');
const nameOf = (item) => {
  const u = item.unit;
  const kind = [u?.make, u?.category].filter(Boolean).join(' ');
  return kind || item.description || item.sku || 'Item';
};

export function loadCount(stops) {
  const items = (stops || []).flatMap((s) => s.items || []);
  return { total: items.length, loaded: items.filter((i) => i.loadedAt).length };
}

// One appliance. With `onToggle` it carries the tick; without, it is the
// read-only row on a stop card.
export function LoadItem({ item, onView, onToggle }) {
  const u = item.unit || {};
  const photos = u.photos || [];
  const name = nameOf(item);
  const sku = u.sku || item.sku;
  return (
    <div className={'drv-item' + (item.loadedAt ? ' is-loaded' : '')}>
      <div className="drv-item-row">
        {photos.length ? (
          <button type="button" className="drv-thumb" onClick={() => onView(item)}
            aria-label={`See ${photos.length} picture${photos.length === 1 ? '' : 's'} of ${name}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[0].url} alt={name} loading="lazy" />
            <span className="drv-thumb-tag">{photos[0].exact ? 'This unit' : 'Model'}{photos.length > 1 ? ` · ${photos.length}` : ''}</span>
          </button>
        ) : (
          <div className="drv-thumb is-none">No picture</div>
        )}
        <div className="drv-item-info">
          <div className="drv-item-name">{Number(item.qty) > 1 ? `${item.qty} × ` : ''}{name}</div>
          {u.model && <div className="drv-item-model">Model {u.model}</div>}
          {item.description && item.description !== name && <div className="drv-item-sub">{item.description}</div>}
          {(u.serial || sku) && (
            <div className="drv-item-sub">{[u.serial && `Serial ${u.serial}`, sku].filter(Boolean).join(' · ')}</div>
          )}
          {u.location && <div className="drv-item-where">📍 Spot {u.location}</div>}
          {!onToggle && item.loadedAt && <div className="drv-item-ok">✓ Loaded</div>}
        </div>
      </div>
      {onToggle && (
        <button type="button" className={'drv-tick' + (item.loadedAt ? ' is-on' : '')}
          aria-pressed={!!item.loadedAt} onClick={() => onToggle(item)}>
          {item.loadedAt
            ? `✓ Loaded${item.loadedBy ? ` · ${item.loadedBy}` : ''} ${hhmm(item.loadedAt)}`
            : '☐ Tap when it is on the van'}
        </button>
      )}
    </div>
  );
}

export function LoadSheet({ title, stops, onToggle, onView, onClose }) {
  const { total, loaded } = loadCount(stops);
  return (
    <div className="drv-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="drv-sheet-inner">
        <div className="drv-sheet-top">
          <b>{title}</b>
          <button type="button" className="drv-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className={'drv-progress' + (loaded === total ? ' is-all' : '')}>
          {loaded === total ? `✓ All ${total} loaded` : `${loaded} of ${total} loaded — ${total - loaded} to go`}
        </div>
        <p className="hint" style={{ margin: '0 0 10px' }}>
          Tap a picture to see it bigger. Check the model or serial on the sticker, then tick it.
        </p>
        {stops.map((s, n) => (s.items?.length ? (
          <section key={s.id} className="drv-load-stop">
            <h3>Stop {n + 1} · {s.customerName || '(no name)'}</h3>
            <div className="drv-ref">
              {[s.city, s.orderNumber || s.jobNumber, s.clientName].filter(Boolean).join(' · ')}
              {s.pickupAddress ? ` · collected from ${s.pickupCompany || s.pickupAddress}` : ''}
            </div>
            {s.items.map((it) => (
              <LoadItem key={it.id} item={it} onView={onView} onToggle={(item) => onToggle(s, item)} />
            ))}
          </section>
        ) : null))}
        <button type="button" className="drv-btn done" onClick={onClose}>Back to stops</button>
      </div>
    </div>
  );
}

// Full screen, swipe sideways. Each picture says whether it is the actual unit.
export function PhotoViewer({ item, onClose }) {
  const photos = item.unit?.photos || [];
  const name = nameOf(item);
  return (
    <div className="drv-viewer" role="dialog" aria-modal="true" aria-label={`Pictures of ${name}`}>
      <div className="drv-viewer-top">
        <div>
          <b>{name}</b>
          {item.unit?.model && <div>Model {item.unit.model}</div>}
        </div>
        <button type="button" className="drv-viewer-x" onClick={onClose}>Close ✕</button>
      </div>
      <div className="drv-viewer-strip">
        {photos.map((p, i) => (
          <figure key={p.url + i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`${name}: ${p.caption}`} />
            <figcaption>{p.caption}{photos.length > 1 ? ` · ${i + 1} of ${photos.length}, swipe` : ''}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
