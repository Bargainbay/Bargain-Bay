'use client';
import { useEffect, useRef, useState } from 'react';
import { queueAction, newRef } from '../lib/driver-outbox';
import { compressPhotos } from './photo-pick';

// Closing out a stop: photos, a signature, who signed, and — where there's money
// owing — what was taken at the door. Everything is captured to the phone first
// and queued; the driver is finished the moment they tap Done, signal or not.

const SERVICE_OUTCOMES = {
  fixed: 'Fixed',
  parts_needed: 'Parts needed',
  not_fixed: 'Not fixed',
  pending: 'Needs another visit',
  no_fault: 'No fault found'
};
const PAY_METHODS = { cash: 'Cash', etransfer: 'E-transfer', card: 'Card (manual)', cheque: 'Cheque', other: 'Other' };

export default function DriverFinish({ stop, onClose, onDone }) {
  const canvas = useRef(null);
  const drawing = useRef(false);
  const signed = useRef(false);
  const [photos, setPhotos] = useState([]);
  const [signedBy, setSignedBy] = useState('');
  const [outcome, setOutcome] = useState('fixed');
  const [partsUsed, setPartsUsed] = useState('');
  const [partsNeeded, setPartsNeeded] = useState('');
  const [note, setNote] = useState('');
  const [collect, setCollect] = useState(stop.balanceDue > 0);
  const [amount, setAmount] = useState(Number(stop.balanceDue || 0).toFixed(2));
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isService = stop.type === 'service_call';

  // The signature pad. Sized to its own box in device pixels so the line lands
  // under the finger on a phone.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#111';
    const pt = (e) => {
      const r = c.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return [t.clientX - r.left, t.clientY - r.top];
    };
    const down = (e) => { drawing.current = true; signed.current = true; const [x, y] = pt(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
    const move = (e) => { if (!drawing.current) return; const [x, y] = pt(e); ctx.lineTo(x, y); ctx.stroke(); e.preventDefault(); };
    const up = () => { drawing.current = false; };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, []);

  function clearSig() {
    const c = canvas.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    signed.current = false;
  }

  // A photo that can't be read now SAYS SO. It used to be swallowed, so a driver
  // tapped, saw nothing appear, and drove off assuming the app didn't do photos.
  async function onPick(e) {
    const files = [...e.target.files].slice(0, 8);
    if (!files.length) return;
    setErr('');
    setBusy(true);
    const { ok, failed } = await compressPhotos(files);
    setPhotos((p) => [...p, ...ok].slice(0, 8));
    setBusy(false);
    if (failed) setErr(`${failed} photo${failed === 1 ? '' : 's'} couldn't be read — try taking it again.`);
    e.target.value = '';
  }

  const dropPhoto = (i) => setPhotos((p) => p.filter((_, n) => n !== i));

  async function submit() {
    setErr('');
    if (isService && !SERVICE_OUTCOMES[outcome]) { setErr('Say how the visit ended.'); return; }
    if (collect && !(Number(amount) > 0)) { setErr('How much did you take?'); return; }
    setBusy(true);
    try {
      const sig = signed.current
        ? await new Promise((r) => canvas.current.toBlob(r, 'image/png'))
        : null;

      // Money first: if the phone can only get one thing out before the signal
      // dies again, it should be the payment — that's the record the customer
      // and the books both depend on.
      if (collect) {
        await queueAction({
          kind: 'patch', jobId: stop.id, ref: newRef(),
          body: { jobId: stop.id, action: 'payment', amount: Number(amount), method, note: 'Collected on delivery' }
        });
      }
      await queueAction({
        kind: 'complete', jobId: stop.id, ref: newRef(),
        signature: sig, photos: photos.map((p) => p.blob),
        fields: {
          timeIn: stop.arrivedAt || stop.startedAt || new Date().toISOString(),
          timeOut: new Date().toISOString(),
          outcome: isService ? outcome : '',
          partsUsed: isService ? partsUsed : '',
          partsNeeded: isService ? partsNeeded : '',
          signedBy, note
        }
      });
      onDone({ hasSignature: !!sig, photoCount: photos.length, balanceDue: collect ? 0 : stop.balanceDue });
    } catch (e) {
      setErr(e?.message || 'Could not save that on the phone.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drv-sheet" role="dialog" aria-label={`Finish ${stop.customerName || 'stop'}`}>
      <div className="drv-sheet-inner">
        <div className="drv-sheet-top">
          <b>Finish · {stop.customerName || stop.jobNumber}</b>
          <button type="button" className="drv-x" onClick={onClose} aria-label="Back">✕</button>
        </div>

        {stop.balanceDue > 0 && (
          <div className="drv-collect big">
            COLLECT ${Number(stop.balanceDue).toFixed(2)}{stop.invoiceNumber ? ` · ${stop.invoiceNumber}` : ''}
          </div>
        )}

        {stop.balanceDue > 0 && (
          <div className="drv-field">
            <label className="drv-check">
              <input type="checkbox" checked={collect} onChange={(e) => setCollect(e.target.checked)} />
              I took the money
            </label>
            {collect && (
              <div className="drv-money">
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount taken" />
                <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="How it was paid">
                  {Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            )}
            {!collect && <div className="drv-warn">Leaving without it? The office will chase it.</div>}
          </div>
        )}

        {isService && (
          <>
            <div className="drv-field">
              <label>How did it end?</label>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                {Object.entries(SERVICE_OUTCOMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="drv-field">
              <label>Parts used</label>
              <input value={partsUsed} onChange={(e) => setPartsUsed(e.target.value)} placeholder="Optional" />
            </div>
            <div className="drv-field">
              <label>Parts still needed</label>
              <input value={partsNeeded} onChange={(e) => setPartsNeeded(e.target.value)} placeholder="Optional" />
            </div>
          </>
        )}

        {/* TWO buttons, not one input. `capture` makes an input camera-ONLY on
            iOS — no library, and `multiple` ignored — so a driver who shot the
            delivery with the normal Camera app had no way to attach it, and a
            bare file input on a phone doesn't read as something you can tap. */}
        <div className="drv-field">
          <label>Photos</label>
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
            {photos.length ? `${photos.length} of 8 added — tap one to remove it.` : 'Up to 8. Optional, but it settles a damage claim.'}
          </div>
          {photos.length > 0 && (
            <div className="drv-thumbs">
              {photos.map((p, i) => (
                <button type="button" key={i} onClick={() => dropPhoto(i)} title="Remove">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Photo ${i + 1}`} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="drv-field">
          <label>Customer signature</label>
          <canvas ref={canvas} className="drv-sig" />
          <button type="button" className="drv-btn small" onClick={clearSig}>Clear</button>
          <div className="hint" style={{ marginTop: 4 }}>Leave blank if nobody was there to sign.</div>
        </div>

        <div className="drv-field">
          <label>Signed by</label>
          <input value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="Name" />
        </div>

        <div className="drv-field">
          <label>Anything to add</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </div>

        {err && <div className="error-box">{err}</div>}

        <button type="button" className="drv-btn done" disabled={busy} onClick={submit}>
          {busy ? 'Saving…' : 'Done — next stop'}
        </button>
      </div>
    </div>
  );
}
