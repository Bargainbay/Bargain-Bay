'use client';
import { useEffect, useRef, useState } from 'react';
import { queueOrSend, newRef } from '../lib/driver-outbox';
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
  // The Proof of Delivery form, as the paper one reads: two damage questions, an
  // explanation when the answer is No, and the item table the customer checks
  // off. Items are PREFILLED from what's on the van — a driver retyping a model
  // number on a doorstep is how "Whirlpool WRFF3536SW" becomes "whirpool fridge".
  const [productOk, setProductOk] = useState('');
  const [propertyOk, setPropertyOk] = useState('');
  const [explain, setExplain] = useState('');
  const [lines, setLines] = useState(() =>
    (stop.items || []).map((it) => ({
      description: it.description || it.sku || '',
      serial: it.sku || '',
      delivered: true,
      notes: ''
    }))
  );
  const setLine = (i, patch) => setLines((xs) => xs.map((l, n) => (n === i ? { ...l, ...patch } : l)));
  const [outcome, setOutcome] = useState('fixed');
  const [partsUsed, setPartsUsed] = useState('');
  const [partsNeeded, setPartsNeeded] = useState('');
  const [note, setNote] = useState('');
  const [collect, setCollect] = useState(stop.balanceDue > 0);
  // A trade-in has to be answered, not defaulted: 'yes' it's on the van, 'no' it
  // isn't. Pre-ticking it would turn the one question that protects a unit we
  // have already paid for into a box nobody reads.
  const hasTradeIn = (stop.tradeIns?.length || 0) > 0 || !!stop.services?.includes('trade_in');
  const [tradeIn, setTradeIn] = useState('');
  const [tradeInNote, setTradeInNote] = useState('');
  const [amount, setAmount] = useState(Number(stop.balanceDue || 0).toFixed(2));
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isService = stop.type === 'service_call';
  // One pair of refs for this close-out, minted once and reused if the driver
  // has to tap Done again. Fresh refs on a retry meant the money and the
  // completion were queued as NEW work: the outbox is keyed on ref, so the same
  // refs simply overwrite the earlier attempt instead of stacking a second
  // payment behind it.
  const refs = useRef(null);
  if (!refs.current) refs.current = { payment: newRef(), complete: newRef() };

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
    // The two damage answers are the whole point of the form — an unanswered one
    // is what a customer disputes six weeks later.
    if (!isService) {
      if (!productOk) { setErr('Is the product damage free? Tap Yes or No.'); return; }
      if (!propertyOk) { setErr('Is the property damage free? Tap Yes or No.'); return; }
      if ((productOk === 'no' || propertyOk === 'no') && !explain.trim()) {
        setErr('Say what the damage is — that box is the whole reason the answer was No.');
        return;
      }
    }
    if (collect && !(Number(amount) > 0)) { setErr('How much did you take?'); return; }
    if (hasTradeIn && !tradeIn) { setErr('Did you load their old unit? Tap Yes or No.'); return; }
    if (hasTradeIn && tradeIn === 'no' && !tradeInNote.trim()) {
      setErr('Say why the trade-in isn’t on the van — the office has to go back for it.');
      return;
    }
    setBusy(true);
    try {
      const sig = signed.current
        ? await new Promise((r) => canvas.current.toBlob(r, 'image/png'))
        : null;

      // Money first: if the phone can only get one thing out before the signal
      // dies again, it should be the payment — that's the record the customer
      // and the books both depend on.
      //
      // queueOrSend, not queueAction: saving to the phone is still the first
      // choice, but a phone that refuses to save must not be able to trap a
      // driver on a doorstep with a signed form and no way to file it. If the
      // storage write fails it goes straight down the wire instead.
      if (collect) {
        await queueOrSend({
          kind: 'patch', jobId: stop.id, ref: refs.current.payment,
          body: { jobId: stop.id, action: 'payment', amount: Number(amount), method, note: 'Collected on delivery' }
        });
      }
      await queueOrSend({
        kind: 'complete', jobId: stop.id, ref: refs.current.complete,
        signature: sig, photos: photos.map((p) => p.blob),
        fields: {
          timeIn: stop.arrivedAt || stop.startedAt || new Date().toISOString(),
          timeOut: new Date().toISOString(),
          outcome: isService ? outcome : '',
          partsUsed: isService ? partsUsed : '',
          partsNeeded: isService ? partsNeeded : '',
          signedBy, note,
          tradeInCollected: hasTradeIn ? tradeIn : '',
          tradeInNote: hasTradeIn && tradeIn === 'no' ? tradeInNote : '',
          podForm: isService ? '' : JSON.stringify({
            productDamageFree: productOk,
            propertyDamageFree: propertyOk,
            explanation: explain,
            printName: signedBy,
            items: lines
          })
        }
      });
      onDone({ hasSignature: !!sig, photoCount: photos.length, balanceDue: collect ? 0 : stop.balanceDue });
    } catch (e) {
      // Say what actually went wrong and what to do about it. The old message
      // was the same eleven words whatever happened — and because a DOMException
      // often carries no message at all, that generic line was what a driver
      // saw for a full signature, a full form and no way forward.
      setErr(
        `${e?.message || 'The phone would not save it.'} `
        + 'Nothing you typed is lost — move to where you have signal and tap Done again. '
        + 'If it still won’t go, ring the office and read it to them.'
      );
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

        {hasTradeIn && (
          <>
            <div className="drv-tradein">
              BRING BACK
              {stop.tradeIns?.length
                ? stop.tradeIns.map((t, i) => <div key={i} className="drv-tradein-unit">{t.description}</div>)
                : <div className="drv-tradein-unit">See the notes</div>}
            </div>
            <div className="drv-field">
              <label>Is their old unit on the van?</label>
              <div className="drv-yesno">
                {['yes', 'no'].map((v) => (
                  <button type="button" key={v}
                    className={'drv-btn' + (tradeIn === v ? ' is-on' : '')}
                    onClick={() => setTradeIn(v)}>{v === 'yes' ? 'Yes' : 'No'}</button>
                ))}
              </div>
              {tradeIn === 'no' && (
                <>
                  <input value={tradeInNote} onChange={(e) => setTradeInNote(e.target.value)}
                    placeholder="Why not? (wouldn't fit, not disconnected, customer changed their mind…)"
                    maxLength={300} style={{ marginTop: 8 }} />
                  <div className="drv-warn">We&apos;ve paid for it — the office will have to send someone back.</div>
                </>
              )}
            </div>
          </>
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

        {!isService && (
          <div className="drv-pod">
            <div className="drv-pod-head">Proof of delivery</div>

            {/* Big Yes/No, not checkboxes: this is answered standing in a
                doorway with a phone in one hand. */}
            <div className="drv-field">
              <label>Product is damage free</label>
              <div className="drv-yesno">
                {['yes', 'no'].map((v) => (
                  <button type="button" key={v}
                    className={'drv-btn' + (productOk === v ? ' is-on' : '')}
                    onClick={() => setProductOk(v)}>{v === 'yes' ? 'Yes' : 'No'}</button>
                ))}
              </div>
            </div>

            <div className="drv-field">
              <label>Property is damage free</label>
              <div className="drv-yesno">
                {['yes', 'no'].map((v) => (
                  <button type="button" key={v}
                    className={'drv-btn' + (propertyOk === v ? ' is-on' : '')}
                    onClick={() => setPropertyOk(v)}>{v === 'yes' ? 'Yes' : 'No'}</button>
                ))}
              </div>
            </div>

            {(productOk === 'no' || propertyOk === 'no') && (
              <div className="drv-field">
                <label>What&apos;s the damage?</label>
                <textarea rows={3} value={explain} onChange={(e) => setExplain(e.target.value)}
                  placeholder="Where it is, how bad, and take a photo of it below" />
              </div>
            )}

            {lines.length > 0 && (
              <div className="drv-field">
                <label>What was delivered</label>
                {lines.map((l, i) => (
                  <div className={'drv-pod-item' + (l.delivered ? '' : ' is-off')} key={i}>
                    <label className="drv-pod-tick">
                      <input type="checkbox" checked={l.delivered}
                        onChange={(e) => setLine(i, { delivered: e.target.checked })} />
                      <span>{l.description}</span>
                    </label>
                    <div className="drv-pod-fields">
                      <input value={l.serial} onChange={(e) => setLine(i, { serial: e.target.value })}
                        placeholder="Serial / SKU" />
                      <input value={l.notes} onChange={(e) => setLine(i, { notes: e.target.value })}
                        placeholder="Notes" />
                    </div>
                  </div>
                ))}
                <div className="hint" style={{ marginTop: 4 }}>
                  Untick anything that didn&apos;t go in. It prints on the form the customer signs.
                </div>
              </div>
            )}
          </div>
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
          <label>Print name</label>
          <input value={signedBy} onChange={(e) => setSignedBy(e.target.value)}
            placeholder="Who signed, in full" autoComplete="name" />
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
