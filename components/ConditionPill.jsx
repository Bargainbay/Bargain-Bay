export default function ConditionPill({ condition }) {
  const cls = 'cond-' + String(condition || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return <span className={`pill ${cls}`}>{condition}</span>;
}
