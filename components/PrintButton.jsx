'use client';

// A button that prints the page it's on.
//
// The run sheet and the POD form are both built to print — page breaks, margins,
// a .noprint class on the chrome — and neither had a way to start one. "Press
// ⌘P" is not a feature; on the tablet in the warehouse there is no ⌘P at all.
//
// Save as PDF is the same dialog, so this covers both: the browser's print sheet
// has "Save as PDF" as a destination.
export default function PrintButton({ label = 'Print / Save as PDF' }) {
  return (
    <button type="button" className="btn accent" onClick={() => window.print()}>
      {label}
    </button>
  );
}
