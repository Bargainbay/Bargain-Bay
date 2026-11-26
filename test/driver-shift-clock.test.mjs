import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';

// Just enough of IndexedDB for the driver's offline queue.
function fakeIdb() {
  const rows = new Map();
  const store = {
    put: (r) => { rows.set(r.ref, r); return { result: r.ref }; },
    getAll: () => ({ result: [...rows.values()] }),
    delete: (ref) => { rows.delete(ref); return {}; }
  };
  const db = { transaction: () => { const t = { objectStore: () => store }; queueMicrotask(() => t.oncomplete()); return t; } };
  return { rows, open: () => { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess(); }); return req; } };
}

async function phone(idb, answer, run) {
  const was = { idb: globalThis.indexedDB, fetch: globalThis.fetch };
  const calls = [];
  globalThis.indexedDB = idb;
  globalThis.fetch = async (url, opts) => {
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
    calls.push(body?.action || 'upload');
    const status = answer(url, body);
    return { ok: status < 300, status, json: async () => ({}) };
  };
  try { await run(calls, await import('../lib/driver-outbox.js')); }
  finally { globalThis.indexedDB = was.idb; globalThis.fetch = was.fetch; }
}

const shiftItem = (ref, action) => ({ kind: 'patch', url: '/api/driver/shift', ref, body: { action, at: Date.now() } });

suite('driver app clock in and out');

test('a clock-in goes straight away, not behind photos already queued', async () => {
  await phone(fakeIdb(), () => 200, async (calls, o) => {
    await o.queueAction({ kind: 'photos', jobId: 1, ref: 'p', photos: [] });
    await o.queueAction(shiftItem('s', 'start'));
    equal(await o.flushShift('s'), 'sent');
    equal(calls.join(), 'start');
  });
});

test('an end never overtakes the start that is still waiting', async () => {
  const idb = fakeIdb();
  await phone(idb, () => 500, async (calls, o) => {
    await o.queueAction(shiftItem('s', 'start'));
    equal(await o.flushShift('s'), 'waiting');
    await o.queueAction(shiftItem('e', 'end'));
    await o.flush();              // the start is backing off, so the end waits too
    assert(!calls.includes('end'), 'end was sent first');
    equal(idb.rows.size, 2);
  });
  await phone(idb, () => 200, async (calls, o) => {
    equal(await o.flushShift('e'), 'sent');
    equal(calls.join(), 'start,end');
    equal(idb.rows.size, 0);
  });
});

test('a refusal is reported and not kept', async () => {
  const idb = fakeIdb();
  await phone(idb, () => 400, async (calls, o) => {
    await o.queueAction(shiftItem('s', 'start'));
    equal(await o.flushShift('s'), 'drop');
    equal(idb.rows.size, 0);
  });
});

test('phone storage that never answers does not swallow the tap', async () => {
  await phone({ open: () => ({}) }, () => 200, async (calls, o) => {
    const r = await o.queueOrSend(shiftItem('s', 'start'));
    equal(r.result, 'sent');
    equal(calls.join(), 'start');
  });
});

test('start, a second start at the same instant, then end', async () => {
  const db = await withTestDb();
  try {
    const { startShift, endShift, openShift, ensureShiftSchema } = await import('../lib/shifts.js');
    const { listDriversForOffice } = await import('../lib/drivers.js');
    await listDriversForOffice();
    await ensureShiftSchema();
    const { rows: [u] } = await db.client.query(
      "INSERT INTO users (email, name, password_hash, is_driver) VALUES ('d2@example.com','Dee','x',true) RETURNING id");
    const tap = { driving: false, at: Date.now() - 3600000 };
    await Promise.all([startShift(u.id, { ...tap, ref: 'a' }), startShift(u.id, { ...tap, ref: 'a' })]);
    const { rows: all } = await db.client.query('SELECT id FROM driver_shifts WHERE user_id = $1', [u.id]);
    equal(all.length, 1);
    await endShift(u.id, { at: Date.now() });
    equal(await openShift(u.id), null);
    equal((await endShift(u.id, { at: Date.now() })).none, true);
  } finally { db.done(); }
});
