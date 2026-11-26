'use client';
// The unticked "text me deals" box, used inside other forms (checkout, signup, quote, giveaway).
// UNTICKED BY DEFAULT, always: a pre-ticked box is not consent.
import { SMS_CONSENT_TEXT } from '../lib/consent-text';

export default function SmsOptIn({ checked, onChange, id = 'sms-opt-in' }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.45, color: 'var(--muted)', fontWeight: 400, cursor: 'pointer', margin: '10px 0 12px', textTransform: 'none', letterSpacing: 0 }}>
      <input id={id} type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, flex: '0 0 auto', width: 'auto', padding: 0 }} />
      <span>{SMS_CONSENT_TEXT}</span>
    </label>
  );
}
