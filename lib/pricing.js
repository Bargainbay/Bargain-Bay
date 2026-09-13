// Single source of truth for the price a viewer sees AND pays.
// Layers: catalog price -> clearance markdown -> member tier. Used by every
// storefront page AND the checkout route (authoritative — never trust client).
import memberPrices from '../data/member-prices.json';
import { clearanceMap } from './clearance';
import { getMembership } from './members';

const MEMBER_CLEARANCE_RATE = 0.90;   // members: 10% off the clearance price
const MEMBER_REGULAR_FALLBACK = 0.55; // members: 55% of retail (if sku missing from member-prices)
const MEMBER_COST_FLOOR = 1.10;       // members: never below cost + 10%

export async function isApprovedMember(session) {
  if (!session?.userId) return false;
  const m = await getMembership(session.userId);
  return !!m && m.role === 'member' && m.member_status === 'approved';
}

// The member price for a regular (non-clearance) unit, bounded on both sides.
//
// THE FLOOR USED TO LIVE IN THE DATA, NOT THE CODE. data/member-prices.json is a
// hand-built table of 139 SKUs whose numbers were already max(55% of retail,
// cost + 10%) when they were written on 2026-06-15. Nothing regenerates it, so
// every unit taken in since — all of vendor intake, every invoice manifest —
// missed the lookup and fell through to a bare 55% of retail with no floor at
// all. That is below cost on any unit bought at more than 55% of retail, which
// is normal for New in Box stock. Found on two LG WashTowers (2026-09-12); it
// was never about those two units, it was every SKU added in three months.
//
// So the floor is computed here now and applied to BOTH branches. For a correct
// row in the table it is a no-op; where the table and the live cost column
// disagree, the live cost wins, because "a member never buys below cost + 10%"
// is the rule and the June numbers are a cache of it.
//
// Cost is read here and leaves this function only as a price. decorate() strips
// the field itself before the unit reaches a page — see the note there.
// The floor itself, in ONE place, because it now has two callers and a rule
// written twice is a rule that drifts. A cost of 0 is a real answer, not a
// missing one — a haul-away cost us nothing (lib/intake.js zeroes it
// deliberately) and so has nothing to floor.
function costFloorOf(unit) {
  const cost = Number(unit.cost) || 0;
  return cost > 0 ? Math.round(cost * MEMBER_COST_FLOOR) : 0;
}

// Hold a member price between the floor and what the public pays for the same
// unit. The CEILING IS APPLIED LAST and so wins: where cost + 10% is already at
// or above the public price, the member simply gets no discount. A member must
// never pay MORE than a regular shopper — if we are selling something below
// cost, we are selling it below cost to them too; they just get no extra cut.
function boundMemberPrice(base, unit, publicPrice) {
  return Math.min(Math.max(base, costFloorOf(unit)), publicPrice);
}

function memberRegular(unit) {
  const explicit = memberPrices[unit.id];
  const retail = unit.compareAt || unit.price || 0;
  const base = typeof explicit === 'number'
    ? explicit
    : (Math.round(retail * MEMBER_REGULAR_FALLBACK) || unit.price);
  // The ceiling previously guarded only the fallback, so a stale table entry on
  // a unit whose price had since dropped could overcharge the member it was
  // meant to reward.
  return boundMemberPrice(base, unit, unit.price);
}

// Clearance: 10% off the marked-down price, floored the same way.
//
// This was deliberately left unfloored when the regular floor went in, on the
// reasoning that clearance exists to shift aged stock and selling below cost is
// a decision somebody made on purpose. That reasoning holds for the CLEARANCE
// PRICE ITSELF and not for the member's extra 10%: the owner marks a unit down
// to a number they have chosen, and a second discount underneath it is not a
// decision anybody made. So the markdown stands for everyone — if it is below
// cost, members buy at it too — and only the further cut is floored.
function memberClearance(unit, cl) {
  return boundMemberPrice(Math.round(cl.price * MEMBER_CLEARANCE_RATE), unit, cl.price);
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
      price = onClearance ? memberClearance(u, cl) : memberRegular(u);
      isMemberPrice = true;
    }
    // COST NEVER LEAVES THIS FUNCTION. Every storefront page hands its decorated
    // units straight to a client component, and a server->client prop is
    // serialised into the RSC payload — so spreading `u` wholesale published
    // what we paid for every unit into the HTML of /shop, the home page, the
    // product page, the cart and /bundle. That is the very thing the member
    // price table was built to avoid (CLAUDE.md: "to keep cost private").
    // Nothing downstream of decorate() reads it: the admin surfaces that show
    // cost — intake, salvage, invoices, the profit report — all query it
    // themselves. Strip it here, at the one boundary every storefront read
    // already passes through, rather than at each page that forgets to.
    const { cost, ...pub } = u; // eslint-disable-line no-unused-vars
    return {
      ...pub,
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
// Returns Map: id -> { price, clientPrice, isMemberPrice, onClearance, title, make, model }.
export async function resolvePrices(units, session) {
  const decorated = await decorate(units, session);
  const map = new Map();
  for (const u of decorated) {
    map.set(u.id, {
      price: u.price, clientPrice: u.clientPrice, isMemberPrice: u.isMemberPrice,
      // Coupons can be set to skip clearance units, so callers need to know
      // which half of the cart a code is allowed to touch.
      onClearance: u.onClearance,
      title: u.title || `${u.make} ${u.model}`, make: u.make, model: u.model
    });
  }
  return map;
}

// deploy 182904Z
