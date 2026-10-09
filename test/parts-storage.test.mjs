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
    const have = new Set(spots.map((x) => x.code));
    for (const c of ['L8-1', 'L8-3', 'L9-1', 'L9-3', 'R1-4', 'R2-4']) equal(have.has(c), true, c);
    equal(have.has('R3-4'), false, 'only R1 and R2 gained a shelf');
    // Retired once, it stays retired: the seed is guarded by the area row.
    await updateSpot('PD8', { active: false }, { admin: true });
    equal((await listLocations()).find((x) => x.code === 'PD8').active, false);
    const { bookInPart, usePart } = await import('../lib/parts.js');
    const { partsInSpots } = await import('../lib/parts.js');
    const a = await bookInPart({ part: { partNumber: 'W10295370A', name: 'Igniter' }, qty: 2, condition: 'new', location: 'PD1' });
    const b = await bookInPart({ part: { name: 'Door gasket' }, qty: 1, condition: 'new', location: 'PD1' });
    await bookInPart({ part: { partNumber: 'X1', name: 'Knob' }, qty: 1, condition: 'new', location: 'PD2' });
    await usePart({ partId: b.part?.id ?? b.partId ?? b.id, qty: 1, location: 'PD1' });
    const m = await partsInSpots(['pd1', 'PD2', 'PD3']);
    equal(m.get('PD1').length, 1, 'the emptied gasket is gone');
    equal(m.get('PD1')[0].partNumber, 'W10295370A');
    equal(m.get('PD2').length, 1);
    equal(m.get('PD3').length, 0, 'empty drawer');
    void a;
  } finally { done(); }
});

