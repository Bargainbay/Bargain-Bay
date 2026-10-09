'use client';
import { useState } from 'react';
import {
  MARKET_CATEGORIES, LISTING_CONDITIONS, PHOTO_ROLES, photoRequirements, EDITABLE_STATUSES, LANES
} from '../lib/listing-rules';
import { CONDITIONS } from '../lib/constants';

const ROLE_LABEL = {
  front: 'Front (full unit)', back: 'Back / side', interior: 'Inside (doors open)', controls: 'Controls, powered on',
  defect: 'A defect, close up', accessories: 'Accessories', other: 'Other', plate: 'Rating plate (private)'
};
const FIELDS = ['category', 'make', 'model', 'serial', 'condition', 'title', 'description', 'price', 'compareAt',
  'compareAtSource', 'widthIn', 'depthIn', 'heightIn', 'weightLb', 'testedWorking', 'testNotes', 'refurbNotes',
  'warrantyMonths', 'deliveryNotes', 'pickupAddress', 'pickupCity', 'pickupPostal', 'lane'];

const val = (v) => (v == null ? '' : v);

export default function ListingEditor({ initial, canSelfShip, canSell, tier }) {
  const [l, setL] = useState(initial);
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, val(initial[k])])));
  const [problems, setProblems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [role, setRole] = useState('front');

  const editable = EDITABLE_STATUSES.includes(l.status);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const req = photoRequirements(form.condition);

  async function patch(body) {
    setBusy(true); setErr(''); setNote('');
    try {
      const res = await fetch(`/api/vendor/listings/${l.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || 'That didn’t work.'); return null; }
      return d;
    } catch { setErr('Network error — please try again.'); return null; } finally { setBusy(false); }
  }
  async function reload() {
    const res = await fetch(`/api/vendor/listings/${l.id}`);
    const d = await res.json();
    if (d.listing) { setL(d.listing); }
  }
  async function save() {
    const d = await patch({ action: 'update', fields: form });
    if (d) { setNote('Saved.'); await reload(); const c = await patch({ action: 'check' }); if (c) setProblems(c.problems); }
  }
  async function check() { await save(); }
  async function submit() {
    if (!(await patch({ action: 'update', fields: form }))) return;
    const d = await patch({ action: 'submit' });
    if (!d) return;
    if (d.ok === false) { setProblems(d.problems); setErr('Fix the items below, then submit again.'); return; }
    setNote('Submitted for review. We will tell you if anything needs changing.');
    window.location.reload();
  }
  async function simple(action, msg) {
    const d = await patch({ action });
    if (d) { setNote(msg); window.location.reload(); }
  }
  async function upload(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setBusy(true); setErr(''); setNote('');
    try {
      const fd = new FormData();
      fd.append('role', role);
      files.forEach((f) => fd.append('photos', f));
      const res = await fetch(`/api/vendor/listings/${l.id}/photos`, { method: 'POST', body: fd });
      const d = await res.json();
      if (d.refused?.length) setErr(d.refused.map((r) => `${r.name}: ${r.problems.join(' ')}`).join('  '));
      if (d.saved?.length) setNote(`${d.saved.length} photo(s) added.`);
      if (!res.ok && !d.refused) setErr(d.error || 'Upload failed.');
      await reload();
    } catch { setErr('Network error — please try again.'); } finally { setBusy(false); }
  }
  async function remove(photoId) {
    setBusy(true); setErr('');
    const res = await fetch(`/api/vendor/listings/${l.id}/photos?photoId=${photoId}`, { method: 'DELETE' });
    const d = await res.json();
    if (!res.ok) setErr(d.error || 'Could not remove that photo.');
    await reload();
    setBusy(false);
  }

  const input = (k, label, props = {}) => (
    <div className="field" key={k}>
      <label>{label}</label>
      <input value={form[k]} onChange={set(k)} disabled={!editable} {...props} />
    </div>
  );
  const photos = l.photos || [];
  const publicPhotos = photos.filter((p) => p.kind === 'public');
  const plate = photos.find((p) => p.role === 'plate');

  return (
    <div>
      <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <a href="/vendor/listings">← Listings</a>
        <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{l.sku}</strong>
        <span className="pill">{l.status.replace('_', ' ')}</span>
        {l.reviewNote && ['changes_requested', 'rejected'].includes(l.status) && <span style={{ fontSize: 14 }}>Reviewer: {l.reviewNote}</span>}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {l.status === 'live' && <button className="btn" disabled={busy} onClick={() => simple('pause', 'Paused.')}>Pause</button>}
          {l.status === 'paused' && <>
            <button className="btn" disabled={busy || !canSell} onClick={() => simple('resume', 'Back on sale.')}>Resume</button>
            <button className="btn" disabled={busy} onClick={() => simple('reopen', 'Reopened for editing — it will be reviewed again.')}>Edit (re-review)</button>
          </>}
          {!['sold', 'reserved', 'withdrawn', 'rejected'].includes(l.status) &&
            <button className="btn danger" disabled={busy} onClick={() => confirm('Withdraw this listing?') && simple('withdraw', 'Withdrawn.')}>Withdraw</button>}
        </span>
      </div>

      {err && <div className="error-box">{err}</div>}
      {note && <div className="panel" style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>{note}</div>}
      {!editable && <div className="panel" style={{ fontSize: 14 }}>
        {l.status === 'live' || l.status === 'paused'
          ? 'This listing is on sale. You can lower the price below; to change anything else, pause it and choose Edit (it will be reviewed again).'
          : 'This listing cannot be edited right now.'}
        {['live', 'paused'].includes(l.status) && (
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={{ width: 140 }} value={form.price} onChange={set('price')} />
            <button className="btn" disabled={busy} onClick={async () => { const d = await patch({ action: 'update', fields: { price: form.price } }); if (d) { setNote('Price lowered.'); await reload(); } }}>Lower price</button>
          </div>
        )}
      </div>}

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>The unit</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '0 16px' }}>
          <div className="field"><label>Category</label>
            <select value={form.category} onChange={set('category')} disabled={!editable}><option value="">Choose…</option>
              {MARKET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          {input('make', 'Make')}
          {input('model', 'Model number (exactly as on the rating plate)')}
          {input('serial', 'Serial number (private — never shown to customers)')}
          <div className="field"><label>Condition</label>
            <select value={form.condition} onChange={set('condition')} disabled={!editable}><option value="">Choose…</option>
              {LISTING_CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select>
            {form.condition && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{CONDITIONS[form.condition]}</div>}
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>A pre-owned unit must be listed as Refurbished — never as new.</div></div>
          <div className="field"><label>How will it be fulfilled?</label>
            <select value={form.lane} onChange={set('lane')} disabled={!editable}>
              <option value="A">{LANES.A}</option>
              <option value="B" disabled={tier < 1}>{LANES.B}{tier < 1 ? ' (Standard tier+)' : ''}</option>
              <option value="C" disabled={!canSelfShip}>{LANES.C}{!canSelfShip ? ' (Standard tier+)' : ''}</option>
            </select></div>
        </div>
        {input('title', 'Title — Make Model — type, size, colour', { maxLength: 120 })}
        <div className="field"><label>Description — what it is and every defect. No contact details.</label>
          <textarea rows={5} value={form.description} onChange={set('description')} disabled={!editable} /></div>
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Price, size and warranty</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '0 16px' }}>
          {input('price', 'Your price (CAD, before tax)', { inputMode: 'decimal' })}
          {input('compareAt', 'Retail price (optional)', { inputMode: 'decimal' })}
          {input('compareAtSource', 'Where the retail price comes from (link or invoice)')}
          {input('warrantyMonths', 'Warranty from you (months, minimum 12)', { inputMode: 'numeric' })}
          {input('widthIn', 'Width (in)', { inputMode: 'decimal' })}
          {input('depthIn', 'Depth (in)', { inputMode: 'decimal' })}
          {input('heightIn', 'Height (in)', { inputMode: 'decimal' })}
          {input('weightLb', 'Weight (lb)', { inputMode: 'decimal' })}
        </div>
        <div className="field"><label><input type="checkbox" checked={!!form.testedWorking} onChange={set('testedWorking')} disabled={!editable} /> I tested this unit and it is working</label></div>
        <div className="field"><label>How it was tested (power-on, full cycle, cooled to temperature…)</label>
          <textarea rows={2} value={form.testNotes} onChange={set('testNotes')} disabled={!editable} /></div>
        {form.condition === 'Refurbished' && <div className="field"><label>What was done to it (cleaned, repaired, parts replaced)</label>
          <textarea rows={2} value={form.refurbNotes} onChange={set('refurbNotes')} disabled={!editable} /></div>}
        <div className="field"><label>Delivery notes (stairs, tight turns, access)</label>
          <textarea rows={2} value={form.deliveryNotes} onChange={set('deliveryNotes')} disabled={!editable} /></div>
        {form.lane === 'B' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '0 16px' }}>
          {input('pickupAddress', 'Pickup address')}{input('pickupCity', 'City')}{input('pickupPostal', 'Postal code')}</div>}
      </div>

      <div className="panel">
        <h2 style={{ marginTop: 0, fontSize: 17 }}>Photos</h2>
        <p style={{ fontSize: 14, marginTop: 0 }}>
          Real photos of <strong>this</strong> unit, at least {req.minPublic}, sharp and well lit, at least 1600px on the long side.
          No logos, watermarks, phone numbers or text on the pictures. Needed: {req.roles.map((r) => ROLE_LABEL[r]).join(' · ')},
          plus a clear photo of the rating plate (customers never see it). We re-save every photo, which removes its location data.
        </p>
        {editable && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <select value={role} onChange={(e) => setRole(e.target.value)} style={{ width: 'auto' }}>
              {PHOTO_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <label className="btn" style={{ cursor: 'pointer' }}>
              {busy ? 'Working…' : 'Add photos'}
              {/* No `capture`: on iOS it makes the input camera-only and ignores `multiple`. */}
              <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={upload} />
            </label>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{publicPhotos.length} public · rating plate {plate ? '✓' : 'missing'}</span>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 10 }}>
          {photos.map((p) => (
            <figure key={p.id} style={{ margin: 0, fontSize: 12 }}>
              {/* contain, never cover: a cropped thumbnail hides the blemish a buyer is checking */}
              <img src={`/api/vendor/photo?id=${p.id}`} alt={p.role} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'contain', background: 'var(--tint)', borderRadius: 6 }} />
              <figcaption>{ROLE_LABEL[p.role] || p.role}{editable && <> · <a href="#" onClick={(e) => { e.preventDefault(); remove(p.id); }}>remove</a></>}</figcaption>
            </figure>
          ))}
        </div>
      </div>

      {problems && (
        <div className="panel">
          <h2 style={{ marginTop: 0, fontSize: 17 }}>{problems.length ? `${problems.length} thing(s) to fix before you can submit` : 'Everything looks complete'}</h2>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{problems.map((p, i) => <li key={i}>{p.text}</li>)}</ul>
        </div>
      )}

      {editable && (
        <div className="panel" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy} onClick={save}>Save draft</button>
          <button className="btn" disabled={busy} onClick={check}>Check what’s missing</button>
          <button className="btn primary" disabled={busy || !canSell} onClick={submit}>Submit for review</button>
        </div>
      )}
    </div>
  );
}
