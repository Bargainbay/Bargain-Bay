// The parts drawers and shelf sections are created once, for both screens.
import { suite, test, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { listLocations, listAreas, updateSpot } from '../lib/locations.js';

suite('Parts storage spots');

test('8 drawers and 16 shelf sections exist, in their own areas', async () => {
  const { done } = await withTestDb();
  try {
    const spots = await listLocations();
    const codes = new Set(spots.map((s) => s.code));
    for (let d = 1; d <= 8; d++) equal(codes.has(`PD${d}`), true, `PD${d}`);
    for (let u = 1; u <= 4; u++) for (let c = 1; c <= 4; c++) equal(codes.has(`P${u}-${c}`), true, `P${u}-${c}`);
    equal(spots.filter((s) => s.area === 'parts-drawers').length, 8);
    equal(spots.filter((s) => s.area === 'parts-shelves').length, 16);
    equal((await listAreas()).some((a) => a.key === 'parts-shelves'), true);
    equal(spots.some((s) => s.code === 'L1-1'), true, 'default layout still seeded');
    // Retired once, it stays retired: the seed is guarded by the area row.
    await updateSpot('PD8', { active: false }, { admin: true });
    equal((await listLocations()).find((x) => x.code === 'PD8').active, false);
  } finally { done(); }
});

