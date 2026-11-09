'use client';

// Open all / close all for the Financial page's folds (same idea as the Operations bar).
// Every section id used on the page is listed here; one missing from this list is simply not reached by the buttons.
const IDS = ['thru', 'live', 'receipts', 'onway', 'trend', 'ar', 'patterns', 'rules', 'plaid', 'tax', 'qbo', 'opex'];

export default function FinFoldBar() {
  function all(state) {
    try { IDS.forEach((id) => localStorage.setItem(`fin-fold:${id}`, state)); } catch { /* noop */ }
    window.dispatchEvent(new CustomEvent('fin-fold-all', { detail: state }));
  }
  return (
    <div className="ops-bar">
      <span className="ops-bar-label">Sections</span>
      <button type="button" className="btn" onClick={() => all('open')}>Open all</button>
      <button type="button" className="btn" onClick={() => all('shut')}>Close all</button>
    </div>
  );
}
