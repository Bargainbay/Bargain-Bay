import { money, pctOff } from '../lib/constants';
import ConditionPill from './ConditionPill';
import AddToCartButton from './AddToCartButton';

// Server-safe card; the add-to-cart button inside is a client component.
// When `count` > 1 the card represents a model group: it shows the cheapest
// unit, a "N available" badge, "from" pricing, and links to that unit's page
// (where the other units of the model are listed) instead of an add-to-cart.
export default function ProductCard({ unit, count = 1 }) {
  const grouped = count > 1;
  const off = pctOff(unit.price, unit.compareAt);
  const href = `/product/${encodeURIComponent(unit.id)}`;
  const name = unit.title || `${unit.make} ${unit.model}`;
  return (
    <div className={'card' + (unit.onClearance ? ' card-clearance' : '')}>
      {unit.onClearance
        ? <span className="clearance-badge">Clearance</span>
        : off > 0 && <span className="off-badge">{off}% off</span>}
      {grouped && <span className="count-badge">{count} available</span>}
      <a href={href} className="thumb">
        <img src={unit.image} alt={name} loading="lazy" />
      </a>
      <div className="card-body">
        <ConditionPill condition={unit.condition} />
        <a href={href} className="card-title">{name}</a>
        <div className="card-model">{unit.make} · {unit.model}</div>
        <div className="price-row">
          {grouped && <span className="from-label">from</span>}
          <span className={'price' + (unit.onClearance ? ' price-clearance' : '') + (unit.isMemberPrice ? ' price-member' : '')}>{money(unit.price)}</span>
          {!grouped && unit.compareAt > unit.price && <span className="compare">{money(unit.compareAt)}</span>}
        </div>
        {unit.isMemberPrice && <div className="member-tag">Member price</div>}
        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          {grouped
            ? <a className="btn block" href={href}>View {count} units →</a>
            : <AddToCartButton sku={unit.id} small price={unit.price} name={name} />}
        </div>
      </div>
    </div>
  );
}
