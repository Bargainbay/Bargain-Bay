import DocBody from './DocBody';
import PrintButton from './PrintButton';

// One how-to guide. Server component; the sections are drawn by DocBody. A guide marked `printable` gets a
// print button and prints as the guide alone (see .doc-print in globals.css).
export default function GuideDoc({ guide }) {
  return (
    <div className={'prose' + (guide.printable ? ' doc-print' : '')}>
      <h1 style={{ marginTop: 0 }}>{guide.title}</h1>
      <p style={{ color: 'var(--muted)', marginTop: 0 }}>{guide.summary}</p>
      {guide.printable && <p className="noprint"><PrintButton label="Print this checklist / Save as PDF" /></p>}
      <DocBody sections={guide.sections()} />
    </div>
  );
}
