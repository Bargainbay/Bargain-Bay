import { money, pctOff } from '../lib/constants';
import ConditionPill from './ConditionPill';
import AddToCartButton from './AddToCartButton';

// Server-safe card; the add-to-cart button inside is a client component.
export default function ProductCard({ unit }) {
  const off = pctOff(unit.price, unit.compareAt);
  const href = `/product/${encodeURIComponent(unit.id)}`;
  const name = unit.title || `${unit.make} ${unit.model}`;
  return (
    <div className={'card' + (unit.onClearance ? ' card-clearance' : '')}>
      {unit.onClearance
        ? <span className="clearance-badge">Clearance</span>
        : off > 0 && <span className="off-badge">{off}% off</span>}
      <a href={href} className="thumb">
        <img src={unit.image} alt={name} loading="lazy" />
      </a>
      <div className="card-body">
        <ConditionPill condition={unit.condition} />
        <a href={href} className="card-title">{name}</a>
        <div className="card-model">{unit.make} · {unit.model}</div>
        <div className="price-row">
          <span className={'price' + (unit.onClearance ? ' price-clearance' : '') + (unit.isMemberPrice ? ' price-member' : '')}>{money(unit.price)}</span>
          {unit.compareAt > unit.price && <span className="compare">{money(unit.compareAt)}</span>}
        </div>
        {unit.isMemberPrice && <div className="member-tag">Member price</div>}
        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          <AddToCartButton sku={unit.id} small price={unit.price} name={name} />
        </div>
      </div>
    </div>
  );
}
