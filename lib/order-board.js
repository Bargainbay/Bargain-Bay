// Everything the orders board needs, in one call.
//
// It exists because that board now has two front doors — its own tab, which is
// what a sales associate has, and the Orders fold on Operations, which is where
// the owner has always found it — and two copies of "load the orders, then the
// drivers, then the reps, then the proof-of-delivery photos" would drift the
// day one of them gained a column.
//
// Every part degrades on its own. A board that won't render because the reps
// table isn't there yet is worse than a board with no rep dropdown.
import { getAllOrders, orderCounts, ORDERS_PAGE } from './orders';
import { listDrivers } from './drivers';
import { listReps } from './reps';
import { podPhotosForOrders } from './pod';
import { currentLocations } from './locations';

// One page of orders, enriched the way the board needs them. Split out of
// orderBoard so "load 200 more" and the date filter go through the SAME
// enrichment as the first paint — a second copy of "attach the items, the POD
// photos and the warehouse locations" would drift the day one of them gained a
// column, which is the reason this module exists at all.
export async function loadOrders(opts = {}) {
  let orders = [];
  let degraded = false;

  try {
    orders = (await getAllOrders(opts)).map((o) => ({
      ...o,
      delivery_date: o.delivery_date ? new Date(o.delivery_date).toISOString().slice(0, 10) : null
    }));
  } catch (e) {
    console.error('orders load failed (run migration?)', e.message);
    degraded = true;
  }

  try {
    const podMap = await podPhotosForOrders(orders.map((o) => o.id));
    orders = orders.map((o) => ({ ...o, pod_photo_ids: podMap.get(o.id) || [] }));
  } catch (e) {
    console.error('pod photos load failed (run migration?)', e.message);
    degraded = true;
  }

  // Where each unit is standing, so whoever pulls the order can walk to it. Not a
  // `degraded` failure: a board with no locations on it is the board as it was.
  try {
    const where = await currentLocations(orders.flatMap((o) => (o.items || []).map((it) => it.sku)));
    orders = orders.map((o) => ({
      ...o,
      items: (o.items || []).map((it) => ({ ...it, location: where.get(it.sku)?.code || null }))
    }));
  } catch (e) {
    console.error('warehouse locations load failed', e.message);
  }

  return { orders, degraded };
}

// Everything the board needs for a first paint: a page of orders, the REAL
// total behind it, plus the drivers and reps the rows' dropdowns are built from.
export async function orderBoard(opts = {}) {
  const { orders, degraded: ordersDegraded } = await loadOrders(opts);
  let drivers = [];
  let reps = [];
  let degraded = ordersDegraded;

  // The counts in the heading. Falls back to what was loaded rather than failing
  // the board — a heading that undercounts is the old behaviour, not an outage,
  // and an empty breakdown simply renders no chips.
  let total = orders.length;
  let byStatus = {};
  try {
    ({ total, byStatus } = await orderCounts(opts));
  } catch (e) {
    console.error('order counts failed', e.message);
  }

  try {
    drivers = await listDrivers();
  } catch (e) {
    console.error('drivers load failed (run migration?)', e.message);
    degraded = true;
  }

  try {
    reps = await listReps();
  } catch (e) {
    console.error('reps load failed', e.message);
  }

  return { orders, total, byStatus, pageSize: ORDERS_PAGE, drivers, reps, degraded };
}
