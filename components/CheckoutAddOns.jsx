'use client';
import { addonsFor } from '../lib/addons';
import { money } from '../lib/constants';

// Installation and haul-away, offered per appliance on a DELIVERY order. The price shown is
// the catalog price handed down by the page; /api/checkout prices it again on the server, and
// anything that does not hold there is dropped rather than charged. Two options in one group
// (existing waterline OR a new one; plain laundry install OR stacking) are alternatives.
export default function CheckoutAddOns({ items, selection, onChange, priceOverrides }) {
  const rows = items
    .map((u) => ({ u, offers: addonsFor(u, { deliveryMethod: 'delivery', priceOverrides }) }))
    .filter((r) => r.offers.length);
  if (!rows.length) return null;

  const toggle = (sku, offer) => {
    const cur = selection[sku] || [];
    const on = cur.includes(offer.key);
    let next = on ? cur.filter((k) => k !== offer.key) : [...cur, offer.key];
    if (!on && offer.group) {
      const same = new Set(rows.find((r) => r.u.id === sku).offers.filter((o) => o.group === offer.group && o.key !== offer.key).map((o) => o.key));
      next = next.filter((k) => !same.has(k));
    }
    onChange({ ...selection, [sku]: next });
  };

  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px', margin: '12px 0' }}>
      <legend style={{ fontWeight: 700, fontSize: 14, padding: '0 6px' }}>Add installation or haul-away (optional)</legend>
      {rows.map(({ u, offers }) => (
        <div key={u.id} style={{ padding: '6px 0', borderTop: '1px solid var(--line-soft, #eee)' }}>
          <div style={{ fontWeight: 600, fontSize: 13.5 }}>{u.make} {u.model}</div>
          {offers.map((o) => {
            const id = `addon-${u.id}-${o.key}`;
            const on = (selection[u.id] || []).includes(o.key);
            return (
              <label key={o.key} htmlFor={id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '4px 0', fontSize: 13.5, cursor: 'pointer' }}>
                <input id={id} type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={on} onChange={() => toggle(u.id, o)} />
                <span style={{ flex: 1 }}>
                  {o.label}
                  {o.note && <span className="hint" style={{ display: 'block', fontSize: 12 }}>{o.note}</span>}
                </span>
                <b style={{ whiteSpace: 'nowrap' }}>{money(o.price)}</b>
              </label>
            );
          })}
        </div>
      ))}
      <div className="hint" style={{ fontSize: 12, marginTop: 6 }}>
        Plus HST. Done by our crew at delivery. Old appliances must be disconnected and emptied; new gas lines, vents and wiring are not included.
      </div>
    </fieldset>
  );
}
