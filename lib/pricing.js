// Single source of truth for the price a viewer sees AND pays.
// Layers: catalog price -> clearance markdown -> member tier. Used by every
// storefront page AND the checkout route (authoritative — never trust client).
import memberPrices from '../data/member-prices.json';
import { clearanceMap } from './clearance';
import { getMembership } from './members';
import { consignmentFloors } from './consignment';
import { round2 } from './constants';
import { DEFAULT_MEMBER_RATES } from './member-rate-rules';
import { getMemberRates } from './member-rates';

// EXPORTED FOR TESTING, and only for that. These four rules decide what a
// member actually pays, they are the most consequential arithmetic in the shop,
// and until now not one of them could be reached from outside this file — so
// the floor bug documented below (every SKU taken in after 2026-06-15 selling
// to members at a bare 55% of retail, found three months later on two LG
// WashTowers) had nothing that could have caught it.
//
// They stay the SINGLE definition. Nothing outside this module and its tests
// should call them: `decorate` is still the only way a price reaches a page.
//
// THESE ARE NOW THE DEFAULTS, not the live numbers. The owner changes the live ones at
// /admin/member-pricing (lib/member-rates.js); every function below takes them as a `rates`
// argument and falls back to these when none is given. decorate() is the only caller that loads
// the saved ones.
export const MEMBER_CLEARANCE_RATE = DEFAULT_MEMBER_RATES.clearanceRate;   // members: 10% off the clearance price
export const MEMBER_REGULAR_FALLBACK = DEFAULT_MEMBER_RATES.regularRate;   // members: 55% of retail (if sku missing from member-prices)
export const MEMBER_COST_FLOOR = DEFAULT_MEMBER_RATES.costFloor;           // members: never below cost + 10%
export const MEMBER_MIN_PROFIT = DEFAULT_MEMBER_RATES.minProfit;           // members: and never for less than $200 clear, where the unit can carry it

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
// The floor itself, in ONE place, because it has several callers and a rule
// written twice is a rule that drifts. A cost of 0 is a real answer, not a
// missing one — a haul-away cost us nothing (lib/intake.js zeroes it
// deliberately) and so has nothing to floor.
//
// TWO floors, whichever is higher: cost + 10%, and $200 clear. The percentage
// alone is what a percentage always is — thin on cheap stock and generous on
// dear stock — and a member sale that nets $30 is not worth the handling.
//
// THE $200 IS ONLY ASKED FOR WHERE THE UNIT CAN ACTUALLY CARRY IT. If what we
// list the unit at is less than $200 above cost, no member price can produce
// $200: the ceiling is the public price and it is lower than the floor would
// be, so the unit would simply lose its member discount and STILL not clear
// $200. Checked against the 132 units live on 2026-09-12: applying the $200
// unconditionally would have taken the member discount off 69 of them, up from
// 22 — and every one of the 47 extra was a unit that could not reach $200
// anyway. It would have charged members list price on half the shop and moved
// the stated goal not at all. So below that headroom the percentage floor
// stands on its own and the member keeps a real discount.
export function costFloorOf(unit, publicPrice, rates = DEFAULT_MEMBER_RATES) {
  const cost = Number(unit.cost) || 0;
  if (cost <= 0) return 0;
  const pct = cost * rates.costFloor;
  const canCarryIt = (Number(publicPrice) || 0) - cost >= rates.minProfit;
  // CEIL, not round: a floor that rounds DOWN is not a floor. Costs carry cents
  // (379.35, 162.25), so rounding put five of the live units at $199.65 clear —
  // under the very minimum this exists to guarantee. The ceiling still caps it,
  // so a unit priced at exactly cost + $200 lands on $200 and not a cent more.
  //
  // round2 BEFORE the ceil, because `cost * 1.10` is binary floating point and
  // lands a hair above the true answer surprisingly often: 400 * 1.10 is
  // 440.00000000000006, which ceils to 441. Across integer costs from $1 to
  // $5,000 that inflated the floor by a dollar on 228 of them — cost $100
  // floored at $111 rather than $110 — so on any unit where the percentage
  // binds, a member paid a pound more than the stated rule. Rounding to the
  // cent first removes the artifact and changes nothing else: a genuine
  // fraction like 379.35 * 1.10 = 417.285 still ceils to 418.
  return Math.ceil(round2(canCarryIt ? Math.max(pct, cost + rates.minProfit) : pct));
}

// Hold a member price between the floor and what the public pays for the same
// unit. The CEILING IS APPLIED LAST and so wins: where cost + 10% is already at
// or above the public price, the member simply gets no discount. A member must
// never pay MORE than a regular shopper — if we are selling something below
// cost, we are selling it below cost to them too; they just get no extra cut.
export function boundMemberPrice(base, unit, publicPrice, rates = DEFAULT_MEMBER_RATES) {
  return Math.min(Math.max(base, costFloorOf(unit, publicPrice, rates)), publicPrice);
}

// `overrides` are the prices typed on /admin/member-pricing; they beat the June table, which
// beats the percentage. Either way the floor and the ceiling still apply.
export function memberRegular(unit, rates = DEFAULT_MEMBER_RATES, overrides = null) {
  const typed = overrides?.[unit.id];
  const explicit = typeof typed === 'number' ? typed : memberPrices[unit.id];
  const retail = unit.compareAt || unit.price || 0;
  const base = typeof explicit === 'number'
    ? explicit
    : (Math.round(retail * rates.regularRate) || unit.price);
  // The ceiling previously guarded only the fallback, so a stale table entry on
  // a unit whose price had since dropped could overcharge the member it was
  // meant to reward.
  return boundMemberPrice(base, unit, unit.price, rates);
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
export function memberClearance(unit, cl, rates = DEFAULT_MEMBER_RATES) {
  return boundMemberPrice(Math.round(cl.price * rates.clearanceRate), unit, cl.price, rates);
}

// The two prices for one unit, in one place: what the public pays and what this viewer pays.
// decorate() uses it for every page and checkout, and the /admin/member-pricing preview uses it
// too, so the screen the owner tunes the rates on cannot disagree with what a member is charged.
export function unitPrices(u, { cl = null, floor = 0, member = false, rates = DEFAULT_MEMBER_RATES, overrides = null } = {}) {
  const clientPrice = Math.max(cl ? cl.price : u.price, floor);
  if (!member) return { clientPrice, price: clientPrice };
  // A price typed on /admin/member-pricing for THIS unit applies on clearance too: it used to be read only
  // on the regular path, so a typed price on a clearance unit was saved and silently ignored. Same bounds
  // as everywhere else: held between the floor and the (clearance) public price.
  const typed = overrides?.[u.id];
  const price = Math.max(
    cl
      ? (typeof typed === 'number'
        ? boundMemberPrice(typed, u, clientPrice, rates)
        : memberClearance(u, { ...cl, price: clientPrice }, rates))
      : memberRegular({ ...u, price: clientPrice }, rates, overrides),
    floor
  );
  return { clientPrice, price };
}

// Decorate units with the final price for this viewer.
// Adds: price (final), clientPrice (non-member price), onClearance, isMemberPrice,
// warrantyMonths. compareAt stays the retail strike-through.
export async function decorate(units, session) {
  const cmap = await clearanceMap();
  const member = await isApprovedMember(session);
  // The saved rates are read only for a member: everyone else's price never touches them.
  const { rates, overrides } = member ? await getMemberRates() : { rates: DEFAULT_MEMBER_RATES, overrides: null };
  // Stock a vendor dropped off: we owe its cost the day it sells, so no layer
  // below may take it under cost + CONSIGNMENT_MIN_MARGIN_PCT. Unlike our own
  // stock, a below-cost clearance markdown is NOT a decision somebody is
  // entitled to make here — the money is somebody else's. The floor is applied
  // to the PUBLIC price, so it governs the member price too (which is capped by
  // the public one). Soft-fails to "nothing is consigned".
  const floors = await consignmentFloors(units.map((u) => u.id));
  return units.map((u) => {
    // A vendor's unit is priced by the vendor and nothing else: no clearance (their consent, their
    // price), no member tier (it is cost-derived and we do not know — or own — their cost), no
    // promo. Without this branch a cost of 0 would read as "floors nothing" and sell a member the
    // unit at 55% of retail.
    if (u.vesta) {
      // Vesta's own list price, nothing layered on it: no clearance, no member tier (we hold no cost for it), no promo.
      const { cost, ...pub } = u; // eslint-disable-line no-unused-vars
      return { ...pub, clientPrice: u.price, onClearance: false, isMemberPrice: false, warrantyMonths: u.warrantyMonths || 24 };
    }
    if (u.marketplace) {
      const { cost, ...pub } = u; // eslint-disable-line no-unused-vars
      return { ...pub, clientPrice: u.price, onClearance: false, isMemberPrice: false, warrantyMonths: u.warrantyMonths || 12 };
    }
    const cl = cmap.get(u.id);
    const onClearance = !!cl;
    const floor = floors.get(u.id)?.floor || 0;
    // (A vendor's uplift is already in u.price: it is applied where the tracker
    // row is read, lib/csv.js, so every surface agrees. Not again here.)
    const { clientPrice, price } = unitPrices(u, { cl, floor, member, rates, overrides });
    const isMemberPrice = !!member;
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
