'use client';

// The consent checkbox, in one place so the wording is identical wherever it
// appears — and because that wording is the EVIDENCE. Under CASL what matters
// is not that a box was ticked but that we can say what the person was told
// when they ticked it, so the exact sentence is stored alongside the consent
// (see CONSENT_TEXT below, which lib/consent records verbatim).
//
// UNTICKED BY DEFAULT, always. A pre-ticked box is not express consent — it is
// the specific thing the legislation was written about, and a consent record
// created from one is worth less than no record at all, because it looks like
// proof.
export const CONSENT_TEXT =
  'Email me occasional deals and new arrivals from Bargain Bay. ' +
  'You can unsubscribe at any time using the link in any of those emails.';

export default function MarketingOptIn({ checked, onChange, id = 'marketing-opt-in' }) {
  return (
    <label
      htmlFor={id}
      style={{
        display: 'flex', gap: 9, alignItems: 'flex-start',
        fontSize: 13.5, lineHeight: 1.45, color: 'var(--muted)',
        fontWeight: 400, cursor: 'pointer', margin: '10px 0 0'
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, flex: '0 0 auto' }}
      />
      <span>{CONSENT_TEXT}</span>
    </label>
  );
}
