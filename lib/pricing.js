// Single source of truth for the price a viewer sees AND pays.
// Layers: catalog price -> clearance markdown -> member tier. Used by every
// storefront page AND the checkout route (authoritative — never trust client).
import memberPrices from '../data/member-prices.json';
import { clearanceMap } from './clearance';
import { getMembership } from './members';

const MEMBER_CLEARANCE_RATE = 0.90;   // members: 10% off the clearance price
const MEMBER_REGULAR_FALLBACK = 0.55; // members: 55% of retail (if sku missing from member-prices)

export async function isApprovedMember(session) {
  if (!session?.userId) return false;
  const m = await getMembership(session.userId);
  return !!m && m.role === 'member' && m.member_status === 'approved';
}

function memberRegular(unit) {
  const m = memberPrices[unit.id];
  if (typeof m === 'number') return m;
  const retail = unit.compareAt || unit.price || 0;
  return Math.round(retail * MEMBER_REGULAR_FALLBACK) || unit.price;
}

// Decorate units with the final price for this viewer.
// Adds: price (final), clientPrice (non-member price), onClearance, isMemberPrice,
// warrantyMonths. compareAt stays the retail strike-through.
export async function decorate(units, session) {
  const cmap = await clearanceMap();
  const member = await isApprovedMember(session);
  return units.map((u) => {
    const cl = cmap.get(u.id);
    const onClearance = !!cl;
    const clientPrice = onClearance ? cl.price : u.price;
    let price = clientPrice;
    let isMemberPrice = false;
    if (member) {
      price = onClearance ? Math.round(cl.price * MEMBER_CLEARANCE_RATE) : memberRegular(u);
      isMemberPrice = true;
    }
    return {
      ...u,
      price,
      clientPrice,
      onClearance,
      isMemberPrice,
      warrantyMonths: onClearance ? (cl.warrantyMonths || 12) : (u.warrantyMonths || 12)
    };
  });
}

export async function decorateOne(unit, session) {
  if (!unit) return unit;
  return (await decorate([unit], session))[0];
}

// Authoritative price lookup for checkout/cart server logic.
// Returns Map: id -> { price, clientPrice, isMemberPrice, title, make, model }.
export async function resolvePrices(units, session) {
  const decorated = await decorate(units, session);
  const map = new Map();
  for (const u of decorated) {
    map.set(u.id, {
      price: u.price, clientPrice: u.clientPrice, isMemberPrice: u.isMemberPrice,
      title: u.title || `${u.make} ${u.model}`, make: u.make, model: u.model
    });
  }
  return map;
}

// deploy 182904Z
