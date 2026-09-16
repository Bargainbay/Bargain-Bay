'use client';
import { useId } from 'react';
import { LEAD_SOURCES, LEAD_SENDER_REQUIRED } from '../lib/constants';

// "Where did this sale come from?" — one editor, used by BOTH the new-invoice
// form and the invoice editor. Shared rather than copy-pasted for the reason
// InvoiceLines is: the two screens were duplicated once before and drifted, and
// a field that means one thing on creation and another on correction produces a
// report nobody trusts.
//
// Two answers, because they are two different questions. The SOURCE is how the
// customer reached us and comes from a fixed list, so the answers stay
// countable. The SENDER is a person's name — the neighbour who recommended us,
// the property manager who keeps sending work, the tech who passed it on — and
// that cannot be a list, because the whole point is finding out who they are.
//
// The sender is REQUIRED on a referral or a trade lead and optional elsewhere:
// "a referral" from nobody in particular is the answer that gets typed in a
// hurry, and it is exactly the one the owner opens this report to chase.
export function leadSenderRequired(source) {
  return LEAD_SENDER_REQUIRED.includes(source);
}

// The one message both screens show, so the rule is stated once.
export function whatsWrongWithLead(source, by) {
  if (!source) return 'Pick where this sale came from — walk-in, website, referral, and so on. It is the one thing nobody can add later from memory.';
  if (leadSenderRequired(source) && !String(by || '').trim()) {
    return `A ${String(LEAD_SOURCES[source] || source).toLowerCase()} needs a name — who sent them? That is the whole point of recording it.`;
  }
  return '';
}

export default function LeadSource({ source, setSource, by, setBy, senders = [] }) {
  const needsName = leadSenderRequired(source);
  // Per-instance, so two of these on one screen can't both answer to the same
  // datalist id — a duplicate id is invalid HTML and the browser silently uses
  // whichever came first, which would be somebody else's list of names.
  const listId = useId();
  return (
    <div className="field">
      <label>Where did this sale come from? *</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select
          value={source || ''}
          onChange={(e) => setSource(e.target.value)}
          style={{ flex: '1 1 200px', minWidth: 180 }}
          aria-label="Lead source"
        >
          <option value="">— how did they reach us? —</option>
          {Object.entries(LEAD_SOURCES).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        <input
          style={{ flex: '1 1 200px', minWidth: 180 }}
          value={by || ''}
          onChange={(e) => setBy(e.target.value)}
          list={listId}
          autoComplete="off"
          aria-label="Who sent the lead"
          placeholder={needsName ? 'Who sent them? *' : 'Sent by (optional)'}
        />
        {/* Suggests names already used, so the report doesn't end up with
            "Dave", "dave" and "Dave S." as three different referrers. */}
        <datalist id={listId}>
          {senders.map((n) => <option key={n} value={n} />)}
        </datalist>
      </div>
      <div className="hint" style={{ marginTop: 4 }}>
        {needsName
          ? 'Put the name of whoever sent them — it is what the referrals report pays out on.'
          : 'A name is optional here, but add one if a person pointed them at us.'}
      </div>
    </div>
  );
}
