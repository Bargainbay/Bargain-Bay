// The driver's loading checklist, and model numbers under invoice lines.
//
// Named zz- so it runs last: the job, invoice and warehouse modules create their
// tables once per process, so running these first leaves a later file's fresh
// database without them.
import { suite, test, equal, assert } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { ensureJobSchema, updateJob, dispatchBoard } from '../lib/jobs.js';
import { driverJobs, setItemLoaded } from '../lib/driver-jobs.js';
import { itemDetails, skuFromDescription } from '../lib/load-list.js';
import { withModels } from '../lib/line-models.js';
import { modelNote } from '../lib/stock-match.js';
import { getPackingSlip } from '../lib/invoices.js';
import { torontoToday } from '../lib/constants.js';

suite('load checklist');

async function seed(client) {
  await ensureJobSchema();
  await client.query(`INSERT INTO products (sku, make, model, category, title, uid)
                      VALUES ('SS-1-001','Whirlpool','WRS321SDHZ','Refrigerator','Whirlpool fridge','SN123')`);
  const u = (await client.query(
    `INSERT INTO users (email, name, password_hash, is_driver) VALUES ('d@x.ca','Dee','x',true) RETURNING id`)).rows[0];
  const j = (await client.query(
    `INSERT INTO jobs (job_number, type, status, address, customer_name, job_date, driver_id)
     VALUES ('RS-7001','delivery','scheduled','1 Main St','Pat',$1,$2) RETURNING id`, [torontoToday(), u.id])).rows[0];
  await client.query(`INSERT INTO job_items (job_id, description, sku) VALUES ($1,'Fridge, white (SS-1-001)','SS-1-001')`, [j.id]);
  const item = (await client.query('SELECT id FROM job_items WHERE job_id = $1', [j.id])).rows[0];
  return { userId: u.id, jobId: j.id, itemId: item.id };
}
const first = async (userId) => (await driverJobs(userId, { details: true })).stops[0].items[0];

test('each item arrives with its model, serial and kind of appliance', async () => {
  const { client, done } = await withTestDb();
  try {
    const { userId } = await seed(client);
    const it = await first(userId);
    equal(it.unit.model, 'WRS321SDHZ'); equal(it.unit.make, 'Whirlpool');
    equal(it.unit.category, 'Refrigerator'); equal(it.unit.serial, 'SN123');
    equal(it.loadedAt, null);
    // Anything else reading a driver's day does not carry the pictures.
    equal((await driverJobs(userId)).stops[0].items[0].unit, undefined);
  } finally { done(); }
});

test('ticking survives a replay, shows on the board, and can be taken back', async () => {
  const { client, done } = await withTestDb();
  try {
    const { userId, jobId, itemId } = await seed(client);
    const at = new Date(Date.now() - 3600_000).toISOString();
    await setItemLoaded(jobId, itemId, true, { by: 'Dee', at });
    await setItemLoaded(jobId, itemId, true, { by: 'Mate', at: new Date().toISOString() });
    const it = await first(userId);
    equal(new Date(it.loadedAt).toISOString(), at); equal(it.loadedBy, 'Dee');
    const board = await dispatchBoard(torontoToday());
    equal(board.jobs[0].items[0].loadedBy, 'Dee');
    await setItemLoaded(jobId, itemId, false, { by: 'Dee' });
    equal((await first(userId)).loadedAt, null);
  } finally { done(); }
});

test('a stop moved to another day has to be loaded again', async () => {
  const { client, done } = await withTestDb();
  try {
    const { jobId, itemId, userId } = await seed(client);
    await setItemLoaded(jobId, itemId, true, { by: 'Dee' });
    await client.query('UPDATE jobs SET job_date = job_date + 1 WHERE id = $1', [jobId]);
    equal((await driverJobs(userId, { details: true })).tomorrow[0].items[0].loadedAt, null);
  } finally { done(); }
});

test('only an item on that stop can be ticked; a rewritten item is not an error', async () => {
  const { client, done } = await withTestDb();
  try {
    const { jobId, itemId } = await seed(client);
    equal((await setItemLoaded(jobId + 999, itemId, true, {})).gone, true);
    equal((await setItemLoaded(jobId, itemId + 999, true, {})).gone, true);
  } finally { done(); }
});

test('saving the edit form keeps the SKU and the tick', async () => {
  const { client, done } = await withTestDb();
  try {
    const { jobId, itemId, userId } = await seed(client);
    await setItemLoaded(jobId, itemId, true, { by: 'Dee' });
    // Exactly what the form sends: the box split on commas, no SKUs.
    const asForm = (text) => ({ items: text.split(',').map((s) => ({ description: s.trim() })), notes: 'ring twice' });
    await updateJob(jobId, asForm('Fridge, white (SS-1-001)'), { name: 'Office' });
    let it = await first(userId);
    equal(it.id, itemId); equal(it.sku, 'SS-1-001'); assert(it.loadedAt);
    // An item added beside it: the pieces still find their unit.
    await updateJob(jobId, asForm('Fridge, white (SS-1-001), Stove'), { name: 'Office' });
    const items = (await driverJobs(userId, { details: true })).stops[0].items;
    equal(items.length, 3);
    equal(items[1].unit.model, 'WRS321SDHZ');
  } finally { done(); }
});

test('a typed line with only a model number still gets a model and a stock picture', async () => {
  const { done } = await withTestDb();
  try {
    const m = await itemDetails([{ id: 1, description: 'LG gas range LRGL5825F to L1W 3T9' }, { id: 2, description: 'One pallet' }]);
    equal(m.get(2).model, ''); equal(m.get(2).photos.length, 0);
    const withPhoto = await itemDetails([{ id: 3, description: 'Hisense fridge RQ22A4CSD' }]);
    equal(withPhoto.get(3).model, 'RQ22A4CSD');
    equal(withPhoto.get(3).photos[0].exact, false);
  } finally { done(); }
});

test('our own photo of the unit comes first and says it is this unit', async () => {
  const { client, done } = await withTestDb();
  try {
    await seed(client);
    await client.query(`CREATE TABLE IF NOT EXISTS unit_photos (id serial PRIMARY KEY, sku text NOT NULL, path text NOT NULL,
      url text NOT NULL, position int NOT NULL DEFAULT 0, created_by text, created_at timestamptz DEFAULT now())`);
    await client.query(`INSERT INTO unit_photos (sku, path, url) VALUES ('SS-1-001','p','/api/photo/SS-1-001-1')`);
    const d = (await itemDetails([{ id: 1, description: 'x', sku: 'ss-1-001' }])).get(1);
    equal(d.photos[0].url, '/api/photo/SS-1-001-1'); equal(d.photos[0].exact, true);
  } finally { done(); }
});

test('a SKU is read back out of a description, and only a SKU', () => {
  equal(skuFromDescription('Fridge (SS-117082-004)'), 'SS-117082-004');
  equal(skuFromDescription('Range (stainless)'), '');
  equal(skuFromDescription('Washer (2024)'), '');
});

suite('invoice model numbers');

test('the model is added only when it says something new', () => {
  equal(modelNote('Whirlpool fridge (SS-1)', 'WRS321SDHZ'), 'WRS321SDHZ');
  equal(modelNote('Whirlpool WRS-321SDHZ fridge', 'WRS321SDHZ'), '');
  equal(modelNote('Laundry centre', 'Laundry Centre'), '');
  equal(modelNote('Fridge', ''), '');
});

test('a unit the site never imported gets its model from the tracker; a service does not', async () => {
  const { done } = await withTestDb();
  try {
    const read = async () => [{ sku: 'BI-1', model: 'MRF18B4AST', make: 'Midea' }];
    const out = await withModels([
      { sku: 'bi-1', kind: 'unit', description: 'a' },
      { sku: 'BI-1', kind: 'service', description: 'Delivery' }
    ], { read });
    equal(out[0].model, 'MRF18B4AST'); equal(out[1].model, undefined);
    const failed = await withModels([{ sku: 'ZZ-9', description: 'b' }], { read: async () => { throw new Error('down'); } });
    equal(failed[0].model, undefined);
  } finally { done(); }
});

test('the packing slip carries the model', async () => {
  const { client, done } = await withTestDb();
  try {
    await client.query(`INSERT INTO products (sku, make, model, category, title) VALUES ('SS-2-001','LG','LRGL5825F','Range','LG range')`);
    // Raw rows: creating a whole invoice is not what is being tested.
    await client.query(`ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS kind text;
                        ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS warranty_months int;
                        ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS refunded_at timestamptz;`);
    const inv = (await client.query(
      `INSERT INTO invoices (number, email, status, subtotal, hst, total) VALUES ('INV-9001','p@x.ca','open',500,65,565) RETURNING id`)).rows[0];
    await client.query(`INSERT INTO invoice_items (invoice_id, description, sku, amount, kind) VALUES ($1,'LG range','ss-2-001',500,'unit')`, [inv.id]);
    equal((await getPackingSlip('INV-9001')).items[0].model, 'LRGL5825F');
  } finally { done(); }
});
