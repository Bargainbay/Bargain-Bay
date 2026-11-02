// How one finished stop reads on a client's invoice. No imports: the invoice
// builder (lib/jobs.js) writes it and the hosted invoice page / PDF read it back
// to find which stop a line belongs to, so the two MUST use one definition.
//
//   202402961            <- the client's reference (order number, else our stop number)
//   Carol Ann Crozier    <- who it was delivered to
//   Delivery             <- the service, then anything else done at the door
//   Haulaway
//   Door Removal/Replace <- the note typed against the charge
export function jobLineDescription({ ref, customer, kind = 'Delivery', services = [], note }) {
  const seen = new Set();
  const parts = [];
  for (const p of [kind, ...services, note]) {
    const t = String(p || '').trim();
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); parts.push(t); }
  }
  return [String(ref || '').trim(), String(customer || '').trim(), ...parts].filter(Boolean).join('\n');
}
