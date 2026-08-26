'use client';

// Open-all / close-all for the Operations page.
//
// Needed because a single open section can be 139 orders tall, and the way out
// of it should not be "scroll back up to the header you came from". Broadcasts
// to every OpsSection and writes each one's stored preference so the choice
// survives a reload like any other.
const IDS = [
  'orders', 'intake-queue', 'purchase-intake', 'intake', 'reconcile',
  'salvage', 'drivers', 'members', 'clearance', 'tools'
];

export default function OpsFoldBar() {
  function all(state) {
    try { IDS.forEach((id) => localStorage.setItem(`ops-fold:${id}`, state)); } catch { /* noop */ }
    window.dispatchEvent(new CustomEvent('ops-fold-all', { detail: state }));
    window.scrollTo({ top: 0 });
  }
  return (
    <div className="ops-bar">
      <span className="ops-bar-label">Sections</span>
      <button type="button" className="btn" onClick={() => all('open')}>Open all</button>
      <button type="button" className="btn" onClick={() => all('shut')}>Close all</button>
    </div>
  );
}
