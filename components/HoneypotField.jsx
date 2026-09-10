'use client';

// Invisible bot trap, shared by the checkout and signup forms.
//
// A real visitor never sees or tabs into this input, so it arrives empty.
// Form-filling bots populate every input they find in the DOM, so a non-empty
// value is a near-certain signal — the server rejects those (see lib/antifraud.js).
//
// Deliberately NOT display:none or hidden — the crudest bots skip those. This is
// off-screen but "rendered", which catches more of them. autoComplete="off" plus
// a non-standard field name keeps password managers from filling it for a human,
// which is the only way this could produce a false positive.
export const HONEYPOT_FIELD = 'website';

export default function HoneypotField({ value, onChange }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-5000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
      <label htmlFor="bb-hp">Do not fill this in</label>
      <input
        id="bb-hp"
        name={HONEYPOT_FIELD}
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
