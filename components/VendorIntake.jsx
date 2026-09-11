'use client';
import { useState, useEffect } from 'react';
import { INTAKE_CATEGORIES as CATEGORIES, INTAKE_CONDITIONS as CONDITIONS } from '../lib/constants';
import { compressPhotos } from './photo-pick';
import { syncSummary } from '../lib/sync-report';

// Vendor drop-off — a unit that goes on the site without passing RS Ops.
//
// Some vendors just leave appliances with us: no invoice, a cost agreed out
// loud, and we settle up once the unit sells. They arrive KNOWN WORKING, so
// there is nothing for the refurb floor to test — and the rep who took it in is
// the person who looked at it, so they are also the person who can photograph
// it and price it.
//
// The whole procedure is one screen on purpose: fill it in, add the photos, add
// it to the tracker, press Sync, and see whether it actually landed. Every one
// of those steps used to belong to somebody else.
// Must match MAX_PHOTOS in lib/unit-photos.js — the server is the one that
// enforces it; this only stops the rep picking twelve and losing four silently.
const MAX_PHOTOS = 8;
const blank = { make: '', model: '', category: 'Refrigerator', condition: '', retail: '', cost: '', vendor: '', serial: '', note: '' };

export default function VendorIntake() {
  const [form, setForm] = useState(blank);
  const [photos, setPhotos] = useState([]);   // { blob, url }
  const [photoWarn, setPhotoWarn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Everything added this session, so the rep can see what they booked in and —
  // after a sync — whether each one is actually on sale.
  const [added, setAdded] = useState([]);     // { sku, title, photos, live, price, note }
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncWarn, setSyncWarn] = useState([]);
  // null = not asked yet / no model typed. Drives the no-stock-photo warning.
  const [stockPhoto, setStockPhoto] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const inp = { padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line)', fontSize: 13.5 };

  // Has this model got a stock photo? Asked as the rep types, debounced, because
  // the answer changes what the listing will look like and they can do something
  // about it now — hand the model to whoever curates data/images.json — rather
  // than discovering a placeholder on the site next week. Never blocks the form.
  useEffect(() => {
    const model = form.model.trim();
    if (!model) { setStockPhoto(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/model-photo?model=${encodeURIComponent(model)}`);
        const d = await res.json();
        if (live && d.asked && d.model === model) setStockPhoto(!!d.hasStock);
      } catch { /* a failed lookup must not nag about a photo that may exist */ }
    }, 450);
    return () => { live = false; clearTimeout(t); };
  }, [form.model]);

  async function pick(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    const room = MAX_PHOTOS - photos.length;
    // Failures are counted, never swallowed: a rep who selects six, sees four
    // and is told nothing concludes the page eats photos.
    const { ok, failed } = await compressPhotos(files.slice(0, room));
    setPhotos((p) => [...p, ...ok]);
    const over = files.length - Math.min(files.length, room);
    setPhotoWarn([
      failed ? `${failed} photo${failed > 1 ? 's' : ''} couldn't be read.` : '',
      over ? `${over} skipped — ${MAX_PHOTOS} is the limit.` : ''
    ].filter(Boolean).join(' '));
  }

  function dropPhoto(i) {
    setPhotos((p) => {
      const next = [...p];
      const [gone] = next.splice(i, 1);
      if (gone) URL.revokeObjectURL(gone.url);
      return next;
    });
  }

  async function add() {
    setErr('');
    if (!form.make.trim() && !form.model.trim()) { setErr('Enter at least a make or model.'); return; }
    if (!form.condition) { setErr('Pick a condition — the tracker works the sale price out from it, and without one the unit will never reach the site.'); return; }
    if (!(Number(form.retail) > 0)) { setErr('Enter the retail price — the sale price is a percentage of it.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set('mode', 'consignment');
      for (const [k, v] of Object.entries(form)) fd.set(k, v);
      photos.forEach((p, i) => fd.append('photos', p.blob, `photo-${i + 1}.jpg`));
      const res = await fetch('/api/admin/intake', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not add that unit.');
      const title = [form.make, form.model].filter(Boolean).join(' ') || form.category;
      setAdded((a) => [{
        sku: d.sku, title, photos: d.photosSaved || 0,
        // `booked` false means the appliance is in the tracker but the "we owe
        // this vendor when it sells" record isn't. The unit is fine and sellable;
        // the money is what needs a person. Say so rather than nothing.
        note: [
          d.booked === false ? 'Added — but the consignment record failed, so the books don\u2019t know we owe for this one. Tell the owner.' : '',
          d.photoError || (d.photosFailed ? `${d.photosFailed} photo(s) didn't save — add them again below.` : '')
        ].filter(Boolean).join(' ')
      }, ...a]);
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      setPhotos([]); setPhotoWarn('');
      setForm({ ...blank, category: form.category, vendor: form.vendor });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // Add more pictures to a unit already booked in — the two extra shots taken at
  // the loading bay after the form was submitted.
  async function addMorePhotos(sku, e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true); setErr('');
    try {
      const { ok, failed } = await compressPhotos(files.slice(0, MAX_PHOTOS));
      const fd = new FormData();
      fd.set('sku', sku);
      ok.forEach((p, i) => fd.append('photos', p.blob, `photo-${i + 1}.jpg`));
      ok.forEach((p) => URL.revokeObjectURL(p.url));
      if (!ok.length) throw new Error("None of those photos could be read.");
      const res = await fetch('/api/admin/unit-photos', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Could not save those photos.');
      setAdded((a) => a.map((u) => u.sku === sku
        ? { ...u, photos: u.photos + (d.photos?.length || 0), note: (d.failed || failed) ? `${(d.failed || 0) + failed} didn't save.` : '' }
        : u));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // Sync, then ASK whether each unit actually went live. The tracker's price
  // cells are formulas that recalculate a beat after a row lands, and a row with
  // no price is dropped by the importer without comment — so "Synced 43 units"
  // is not an answer to "is my fridge on the site".
  async function sync() {
    setSyncing(true); setSyncMsg('');
    try {
      const res = await fetch('/api/admin/sync-inventory', { method: 'POST' });
      const d = await res.json();
      if (!res.ok) { setSyncMsg(`✗ ${d.error || 'Sync failed.'}`); setSyncWarn([]); return; }
      const { ok, warnings } = syncSummary(d);
      setSyncMsg(`✓ ${ok}`);
      setSyncWarn(warnings);
      const skus = added.map((u) => u.sku);
      if (skus.length) {
        const r = await fetch(`/api/admin/intake?skus=${encodeURIComponent(skus.join(','))}`);
        const s = await r.json();
        const by = new Map((s.units || []).map((u) => [u.sku, u]));
        setAdded((a) => a.map((u) => ({ ...u, live: by.get(u.sku)?.live, price: by.get(u.sku)?.price })));
      }
    } catch {
      setSyncMsg('✗ Network error.'); setSyncWarn([]);
    } finally { setSyncing(false); }
  }

  return (
    <div className="panel" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0, color: 'var(--charcoal)' }}>Vendor drop-off</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        For appliances a vendor leaves with us — <b>no invoice</b>, a cost agreed with them, and we pay
        once the unit sells. These arrive already working, so they skip the refurb floor: this writes the
        unit into the <b>master tracker</b> as <b>Tested Working</b>, and your photos go on the product page
        under <b>&ldquo;Photos of this exact unit&rdquo;</b>. Press <b>Sync inventory</b> underneath when
        you&apos;re done and it goes live.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Make" value={form.make} onChange={set('make')} style={{ ...inp, width: 130 }} />
        <input placeholder="Model" value={form.model} onChange={set('model')} style={{ ...inp, width: 150 }} />
        <select value={form.category} onChange={set('category')} style={inp}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={form.condition} onChange={set('condition')} style={inp} title="Sets the price tier — required.">
          <option value="">Condition…</option>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="number" min="0" step="0.01" placeholder="Retail $" value={form.retail} onChange={set('retail')}
          style={{ ...inp, width: 96 }} title="Retail / MSRP. The sale price is this × the condition tier." />
        <input type="number" min="0" step="0.01" placeholder="Cost $" value={form.cost} onChange={set('cost')}
          style={{ ...inp, width: 92 }} title="What we've agreed to pay the vendor when it sells." />
        <input placeholder="Vendor" value={form.vendor} onChange={set('vendor')} style={{ ...inp, width: 130 }} />
        <input placeholder="Serial (optional)" value={form.serial} onChange={set('serial')} style={{ ...inp, width: 150 }} />
        <input placeholder="Note for the tracker (optional)" value={form.note} onChange={set('note')} style={{ ...inp, width: 220 }}
          title="Goes in the Invoice column beside CONSIGNMENT — e.g. the terms, or who dropped it off." />
      </div>

      {stockPhoto === false && (
        <div className="hint" style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)' }}>
          ⚠ <b>No stock photo on file for {form.model.trim()}.</b> The unit will still list and sell, but its card
          will show a category placeholder until somebody adds one — and Meta ads skip a unit whose card is a
          placeholder. Your photos below appear underneath either way. Worth passing the model on.
        </div>
      )}

      {/* TWO buttons, not one input. `capture` makes an input camera-ONLY on
          iOS — no library, and `multiple` ignored — so a rep who shot the unit
          with the normal Camera app would have no way to attach it. */}
      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="btn" style={{ padding: '7px 12px', cursor: 'pointer' }}>
          📷 Take a photo
          <input type="file" accept="image/*" capture="environment" onChange={pick} style={{ display: 'none' }} />
        </label>
        <label className="btn" style={{ padding: '7px 12px', cursor: 'pointer' }}>
          🖼 Choose photos
          <input type="file" accept="image/*" multiple onChange={pick} style={{ display: 'none' }} />
        </label>
        <span className="hint">
          {photos.length
            ? `${photos.length} of ${MAX_PHOTOS} — tap one to remove it. They show in this order on the product page.`
            : `Up to ${MAX_PHOTOS}. The listing photo stays the manufacturer's stock picture; these go underneath it, and they're what actually sells a used machine.`}
        </span>
      </div>
      {photoWarn && <div className="hint" style={{ color: 'var(--danger, #b00)', marginTop: 6 }}>{photoWarn}</div>}
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {photos.map((p, i) => (
            <button type="button" key={p.url} onClick={() => dropPhoto(i)} title="Remove"
              style={{ padding: 0, border: '1px solid var(--line)', borderRadius: 8, background: 'none', cursor: 'pointer', lineHeight: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Photo ${i + 1}`} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 6 }} />
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button className="btn primary" style={{ padding: '8px 16px' }} disabled={busy} onClick={add}>
          {busy ? 'Adding…' : 'Add to tracker'}
        </button>
      </div>
      {err && <div className="error-box" style={{ marginTop: 10 }}>{err}</div>}

      {added.length > 0 && (
        <>
          <h3 style={{ color: 'var(--charcoal)', margin: '20px 0 8px' }}>Added just now ({added.length})</h3>
          <div className="table-wrap"><table className="admin">
            <thead><tr><th>Unit</th><th>SKU</th><th>Photos</th><th>On the site</th></tr></thead>
            <tbody>
              {added.map((u) => (
                <tr key={u.sku}>
                  <td>{u.title}{u.note && <div style={{ fontSize: 12, color: 'var(--danger, #b00)' }}>{u.note}</div>}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{u.sku}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {u.photos}
                    <label className="btn" style={{ padding: '2px 8px', fontSize: 12, marginLeft: 6, cursor: 'pointer' }}>
                      + add
                      <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                        onChange={(e) => addMorePhotos(u.sku, e)} />
                    </label>
                  </td>
                  <td>
                    {u.live === undefined ? <span className="hint">press Sync</span>
                      : u.live ? <span style={{ color: 'var(--green, #157347)' }}>✓ live{u.price ? ` · $${u.price}` : ''}</span>
                        : <span style={{ color: 'var(--danger, #b00)' }}>not live yet — check the tracker row has a Condition and a Retail price, then sync again</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <button className="btn primary" disabled={syncing} onClick={sync}>
          {syncing ? 'Syncing…' : 'Sync inventory from tracker'}
        </button>
        <p className="hint" style={{ marginTop: 6 }}>
          Copies the tracker into the website. Give it a few seconds after adding a unit — the tracker
          works the sale price out with a formula, and syncing before it has finished skips the unit
          silently. The list above tells you which ones made it.
        </p>
        {syncMsg && <div className="hint" style={{ marginTop: 6 }}>{syncMsg}</div>}
        {/* The number that would have explained the 2026-09-10 outage. A sync
            that imports fewer units than the tracker holds must say so. */}
        {syncWarn.map((w) => (
          <div key={w} className="error-box" style={{ marginTop: 8 }}>⚠ {w}</div>
        ))}
      </div>
    </div>
  );
}
