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
import { getAllOrders } from './orders';
import { listDrivers } from './drivers';
import { listReps } from './reps';
import { podPhotosForOrders } from './pod';

export async function orderBoard(limit = 200) {
  let orders = [];
  let drivers = [];
  let reps = [];
  let degraded = false;

  try {
    orders = (await getAllOrders(limit)).map((o) => ({
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

  return { orders, drivers, reps, degraded };
}
