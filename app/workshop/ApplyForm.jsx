'use client';
import { useState } from 'react';
import HoneypotField, { HONEYPOT_FIELD } from '../../components/HoneypotField';

export default function ApplyForm({ experience, heardFrom, priceLabel }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', city: '', experience: '', apprenticeship: false, about: '', heardFrom: '', [HONEYPOT_FIELD]: '' });
  const [state, setState] = useState({ busy: false, error: '', done: false });
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, error: '', done: false });
    try {
      const r = await fetch('/api/workshop-apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not submit. Please try again.');
      setState({ busy: false, error: '', done: true });
    } catch (err) {
      setState({ busy: false, error: err.message, done: false });
    }
  }

  if (state.done) {
    return (
      <div className="ws-thanks" role="status">
        <h3>Application received</h3>
        <p>Thank you, {f.name.split(' ')[0] || 'friend'}. We&apos;ll contact you within two business days to confirm your seat and how to pay the {priceLabel} tuition. Nothing is charged until we speak.</p>
      </div>
    );
  }

  return (
    <form className="ws-form" onSubmit={submit}>
      <HoneypotField value={f[HONEYPOT_FIELD]} onChange={set(HONEYPOT_FIELD)} />
      <div className="ws-row">
        <label>Full name<input required value={f.name} onChange={set('name')} autoComplete="name" /></label>
        <label>City<input value={f.city} onChange={set('city')} autoComplete="address-level2" placeholder="e.g. Pickering" /></label>
      </div>
      <div className="ws-row">
        <label>Email<input required type="email" value={f.email} onChange={set('email')} autoComplete="email" /></label>
        <label>Phone<input required type="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" /></label>
      </div>
      <div className="ws-row">
        <label>Your experience
          <select value={f.experience} onChange={set('experience')}>
            <option value="">Select…</option>
            {experience.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label>How did you hear about us?
          <select value={f.heardFrom} onChange={set('heardFrom')}>
            <option value="">Select…</option>
            {heardFrom.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
      </div>
      <label>Tell us a little about you and why you want to learn (optional)
        <textarea rows={4} maxLength={1500} value={f.about} onChange={set('about')} />
      </label>
      <label className="ws-check">
        <input type="checkbox" checked={f.apprenticeship} onChange={set('apprenticeship')} />
        <span>I&apos;d like to be considered for the apprenticeship program.</span>
      </label>
      {state.error && <p className="ws-error" role="alert">{state.error}</p>}
      <button className="ws-btn" disabled={state.busy}>{state.busy ? 'Sending…' : 'Apply for a seat'}</button>
      <p className="ws-fine">Applying is free and doesn&apos;t commit you. We&apos;ll use your details only to contact you about the workshop.</p>
    </form>
  );
}
