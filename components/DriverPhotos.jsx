'use client';
import { useState } from 'react';
import { compressPhotos } from './photo-pick';

// Photos onto a stop that's already closed out.
//
// The pictures are the one part of a stop a driver reliably remembers AFTER
// walking away from it — the fridge was already dented, the door wouldn't clear,
// nobody was home so it went in the garage. Before this the only route was
// texting them to the office, which is where proof goes to die.
//
// Queued through the same outbox as everything else, so it works in a basement.
export default function DriverPhotos({ stop, onClose, onAdded }) {
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function onPick(e) {
    const files = [...e.target.files].slice(0, 8);
    if (!files.length) return;
    setErr(''); setBusy(true);
    const { ok, failed } = await compressPhotos(files);
    setPhotos((p) => [...p, ...ok].slice(0, 8));
    setBusy(false);
    if (failed) setErr(`${failed} photo${failed === 1 ? '' : 's'} couldn't be read — try taking it again.`);
    e.target.value = '';
  }

  async function send() {
    if (!photos.length) { setErr('Add a photo first.'); return; }
    setBusy(true);
    await onAdded(photos.map((p) => p.blob));
    setBusy(false);
  }

  return (
    <div className="drv-sheet">
      <div className="drv-sheet-inner">
        <div className="drv-sheet-top">
          <b>Add photos · {stop.customerName || stop.jobNumber}</b>
          <button type="button" className="drv-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <p className="hint" style={{ marginTop: 0 }}>
          These go onto the stop you already finished. The office sees them on the job.
        </p>

        {err && <div className="error-box">{err}</div>}

        <div className="drv-field">
          <div className="drv-photo-btns">
            <label className="drv-btn small">
              📷 Take a photo
              <input className="drv-file" type="file" accept="image/*" capture="environment" onChange={onPick} />
            </label>
            <label className="drv-btn small">
              🖼 Choose from phone
              <input className="drv-file" type="file" accept="image/*" multiple onChange={onPick} />
            </label>
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            {photos.length ? `${photos.length} of 8 ready — tap one to remove it.` : 'Up to 8 at a time.'}
          </div>
          {photos.length > 0 && (
            <div className="drv-thumbs">
              {photos.map((p, i) => (
                <button type="button" key={i} onClick={() => setPhotos((x) => x.filter((_, n) => n !== i))} title="Remove">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Photo ${i + 1}`} />
                </button>
              ))}
            </div>
          )}
        </div>

        <button type="button" className="drv-btn done" disabled={busy || !photos.length} onClick={send}>
          {busy ? 'Saving…' : `Add ${photos.length || ''} photo${photos.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  );
}
