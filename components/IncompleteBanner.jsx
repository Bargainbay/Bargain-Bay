// "Some of this is missing" — said once, loudly, above the numbers.
//
// The financial pages soft-fail every query so a report renders rather than
// 500s, which is the right call. What was missing was any way for the reader to
// know it had happened: a section that could not be read came back as zero
// rows, and zero rows looks exactly like a quiet month. See lib/partial.
//
// Deliberately NOT a dismissible toast and NOT below the fold. It prints, too —
// these pages carry a Print button and go to an accountant on paper.
export default function IncompleteBanner({ warning }) {
  if (!warning) return null;
  return (
    <div
      role="alert"
      style={{
        border: '2px solid #b3261e',
        background: '#fdf3f2',
        color: '#5f1512',
        borderRadius: 8,
        padding: '12px 14px',
        margin: '0 0 16px',
        fontSize: 14,
        lineHeight: 1.5
      }}
    >
      <b style={{ display: 'block', fontSize: 15, marginBottom: 4 }}>
        These figures are incomplete — do not file or report from them.
      </b>
      {warning.sections.length === 1
        ? <>The <b>{warning.sections[0]}</b> section could not be read.</>
        : <>These sections could not be read: <b>{warning.sections.join(', ')}</b>.</>}
      {warning.timedOut && <> The read timed out — try a shorter period.</>}
      {' '}
      {/* The specific trap: every journal entry is a balanced pair, so a
          dropped query drops both sides and the trial balance still balances. */}
      A balanced trial balance does <b>not</b> rule this out: each entry is a
      debit and a credit together, so a whole section going missing takes both
      halves with it and the totals still agree.
    </div>
  );
}
