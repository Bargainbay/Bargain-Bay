// Marketplace bulk upload: the parser (pure) and preview/confirm against a real database.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { createApplication, decideApplication } from '../lib/vendors.js';
import { acceptPolicies } from '../lib/policy-acceptance.js';
import { requiredPolicies } from '../lib/marketplace-policies.js';
import { createDraft, submitListing, listVendorListings, getVendorListing } from '../lib/marketplace-listings.js';
import {
  bulkTemplateCsv, parseGrid, parseBulk, previewBulk, confirmBulk, BULK_COLUMNS, BULK_MAX_ROWS, EXAMPLE_SERIAL
} from '../lib/listing-bulk.js';
import { query } from '../lib/db.js';

const HEAD = BULK_COLUMNS.map((c) => c.head);
const base = (over = {}) => ({
  category: 'Refrigerator', make: 'Whirlpool', model: 'WRF535SWHZ', serial: 'SN-1', condition: 'Refurbished',
  title: 'Whirlpool WRF535SWHZ — French door fridge, 36", stainless',
  description: 'Deep cleaned, new door gasket fitted, cools to temperature. Small scratch on the left side panel.',
  price: 899, compare_at: '', compare_at_source: '', width_in: 36, depth_in: 34, height_in: 70, weight_lb: 280,
  warranty_months: 12, lane: 'A', tested_working: 'yes', test_notes: 'Ran 24 hours, freezer -18C', tested_on: '',
  refurb_notes: 'Deep cleaned, replaced gasket', delivery_notes: '', pickup_address: '', pickup_city: '', pickup_postal: '', ...over
});
const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const csv = (rows, delim = ',') => [HEAD.join(delim), ...rows.map((r) => HEAD.map((h) => q(r[h] ?? '')).join(delim))].join('\n');

async function vendor(name) {
  const v = await createApplication({ legalName: name, contactEmail: `${name.toLowerCase().replace(/\W/g, '')}@example.com` });
  await decideApplication(v.id, { approve: true, by: 'staff', hstStatus: 'registered' });
  await acceptPolicies(v.id, { role: 'owner', by: 'owner@example.com', accepting: requiredPolicies().map((p) => ({ policy: p.slug, version: p.version })) });
  return v;
}
async function rejects(fn, re) {
  let err; try { await fn(); } catch (e) { err = e; }
  assert(err, 'expected it to throw');
  if (re) assert(re.test(err.message), `message was: ${err.message}`);
}

// ---------------------------------------------------------------------------
suite('bulk upload — reading the file');

test('quote-only-at-field-start: inches in a title do not swallow the row', () => {
  const g = parseGrid('a,b,c\nWhirlpool 36" Fridge,second,third');
  equal(g[1].length, 3); equal(g[1][0], 'Whirlpool 36" Fridge'); equal(g[1][2], 'third');
});

test('quoted fields keep commas, doubled quotes and line breaks; BOM and Excel errors handled', () => {
  const g = parseGrid('﻿a,b\n"x, ""y""\nz",#N/A\n');
  equal(g.length, 2); equal(g[1][0], 'x, "y"\nz'); equal(g[1][1], '');
});

test('tab-separated Excel paste and semicolons are sniffed', () => {
  equal(parseGrid('a\tb\n1\t2')[1][1], '2');
  equal(parseGrid('a;b\n1;2')[1][1], '2');
});

test('the template round-trips: every column is recognised, and only the example row is flagged', () => {
  const p = parseBulk(bulkTemplateCsv());
  equal(p.fileProblems.length, 0); equal(p.ignored.length, 0); equal(p.rows.length, 1);
  equal(p.columns.length, BULK_COLUMNS.length);
  assert(p.rows[0].problems.some((x) => /example row/.test(x.text)), 'example row blocked');
  equal(p.rows[0].problems.length, 1);
  equal(p.rows[0].input.serial, EXAMPLE_SERIAL); equal(p.rows[0].input.price, 899); equal(p.rows[0].input.testedWorking, true);
});

test('missing columns, over-cap, empty and duplicate headings are file-level problems', () => {
  assert(/missing these columns/.test(parseBulk('make,model\nA,B').fileProblems[0]), 'missing');
  const many = csv(Array.from({ length: BULK_MAX_ROWS + 1 }, (_, i) => base({ serial: `S${i}` })));
  assert(/limit is 100/.test(parseBulk(many).fileProblems[0]), 'cap says so');
  equal(parseBulk('').fileProblems.length, 1);
  assert(/twice/.test(parseBulk(`${HEAD.join(',')},price\n`).fileProblems.join(' ') + parseBulk(`${HEAD.join(',')},price\n${HEAD.map(() => 'x').join(',')},1`).fileProblems.join(' ')), 'duplicate column');
});

test('numbers, yes/no, dates and formula characters are cleaned or named', () => {
  const p = parseBulk(csv([base({ price: '$1,299.00', weight_lb: '280 lbs', tested_working: 'Y', title: '=cmd|bad Whirlpool fridge stainless', tested_on: 'tomorrow' }),
    base({ serial: 'S2', price: 'abc', tested_working: 'maybe' })]));
  equal(p.rows[0].input.price, 1299); equal(p.rows[0].input.weightLb, 280); equal(p.rows[0].input.testedWorking, true);
  assert(!p.rows[0].input.title.startsWith('='), 'formula stripped'); equal(p.rows[0].warnings.length, 1);
  assert(p.rows[0].problems.some((x) => /2026-10-01/.test(x.text)), 'date');
  assert(p.rows[1].problems.some((x) => /not a number/.test(x.text)), 'bad number');
  assert(p.rows[1].problems.some((x) => /yes or no/.test(x.text)), 'bad bool');
});

// ---------------------------------------------------------------------------
suite('bulk upload — preview and confirm against a real database');

const count = async (vid) => Number((await query('SELECT count(*) FROM marketplace_listings WHERE vendor_id = $1', [vid])).rows[0].count);

test('a good file previews clean, writes nothing, then confirms into DRAFTS only', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const text = csv([base({ serial: 'SN-1' }), base({ serial: 'SN-2', model: 'WRF560SEHZ' })], '\t');
    const pv = await previewBulk(a.id, text);
    assert(pv.ok); equal(pv.counts.ready, 2); equal(pv.counts.blocked, 0);
    equal(await count(a.id), 0, 'preview writes nothing');
    const r = await confirmBulk(a.id, text, pv.token, { by: 'a@example.com' });
    equal(r.created.length, 2); equal(r.failed.length, 0);
    const l = await getVendorListing(a.id, r.created[0].id);
    equal(l.status, 'draft'); equal(l.serial, 'SN-1'); equal(l.price, 899); equal(l.testedWorking, true); equal(l.lane, 'A');
    equal(r.created[0].sku, `MP-${a.id}-0001`); equal(r.created[1].sku, `MP-${a.id}-0002`);
    // no photos -> cannot be submitted (existing rule)
    const s = await submitListing(a.id, l.id, { by: 'a@example.com' });
    assert(!s.ok && s.problems.some((p) => p.field === 'photos'), 'photos still required');
  } finally { done(); }
});

test('bad rows are named in plain language, with the same rules as the single path; good rows still import', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const text = csv([
      base({ serial: 'OK-1' }),
      base({ serial: 'BAD-1', condition: 'Used', title: 'FRIDGE', warranty_months: 6, description: 'call 416-555-0199' })
    ]);
    const pv = await previewBulk(a.id, text);
    equal(pv.counts.ready, 1); equal(pv.counts.blocked, 1);
    const bad = pv.rows[1].problems.map((p) => p.text).join(' | ');
    assert(/Refurbished/.test(bad) && /title/i.test(bad) && /phone number/.test(bad) && /warranty/i.test(bad), bad);
    assert(!pv.rows[1].problems.some((p) => p.field === 'photos'), 'photos are not asked for in a spreadsheet');
    const r = await confirmBulk(a.id, text, pv.token);
    equal(r.created.length, 1); equal(r.failed.length, 1); equal(r.failed[0].row, 3);
    equal(await count(a.id), 1);
  } finally { done(); }
});

test('a serial twice in the file: the second is refused and points at the first row', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const pv = await previewBulk(a.id, csv([base({ serial: ' sn-9 ' }), base({ serial: 'SN-9' })]));
    equal(pv.rows[0].ok, true);
    assert(pv.rows[1].problems.some((p) => /row 2 of your file/.test(p.text)), JSON.stringify(pv.rows[1].problems));
  } finally { done(); }
});

test('a serial live with another vendor is refused WITHOUT saying who; their drafts do not count; your own are named', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Bravo');
    // Bravo has a live-ish listing (in review) with SN-X, and a draft with SN-D.
    const x = await createDraft(b.id, { ...{ category: 'Refrigerator', serial: 'SN-X' } });
    await query(`UPDATE marketplace_listings SET status='in_review' WHERE id=$1`, [x.id]);
    await createDraft(b.id, { serial: 'SN-D' });
    // Alpha has its own draft with SN-OWN.
    const own = await createDraft(a.id, { serial: 'SN-OWN' });
    const pv = await previewBulk(a.id, csv([base({ serial: 'SN-X' }), base({ serial: 'SN-D' }), base({ serial: 'SN-OWN' })]));
    const t0 = pv.rows[0].problems.map((p) => p.text).join(' ');
    assert(/already listed/.test(t0) && !/Bravo/i.test(t0) && !new RegExp(`MP-${b.id}`).test(t0), t0);
    equal(pv.rows[1].ok, true, 'another vendor\'s draft is not a clash');
    assert(pv.rows[2].problems.some((p) => p.text.includes(own.sku)), 'own listing is named');
  } finally { done(); }
});

test('REPLAY: confirming the same preview twice creates nothing the second time', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const text = csv([base({ serial: 'R-1' }), base({ serial: 'R-2' })]);
    const pv = await previewBulk(a.id, text);
    const one = await confirmBulk(a.id, text, pv.token);
    const two = await confirmBulk(a.id, text, pv.token);
    equal(one.created.length, 2); equal(two.created.length, 0); equal(two.already.length, 2); equal(two.failed.length, 0);
    equal(two.already[0].sku, one.created[0].sku);
    equal(await count(a.id), 2);
  } finally { done(); }
});

test('the server re-validates: a changed file does not match its preview token', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const pv = await previewBulk(a.id, csv([base({ serial: 'T-1' })]));
    await rejects(() => confirmBulk(a.id, csv([base({ serial: 'T-1', price: 1 }), base({ serial: 'T-2' })]), pv.token), /previewed/);
    await rejects(() => confirmBulk(a.id, csv([base({ serial: 'T-1' })]), ''), /previewed/);
    equal(await count(a.id), 0);
    // and a clash that appears AFTER the preview is caught at confirm, per row
    const text = csv([base({ serial: 'LATE-1' }), base({ serial: 'LATE-2' })]);
    const p2 = await previewBulk(a.id, text);
    const b = await vendor('Bravo');
    const y = await createDraft(b.id, { serial: 'LATE-2' });
    await query(`UPDATE marketplace_listings SET status='live' WHERE id=$1`, [y.id]);
    const r = await confirmBulk(a.id, text, p2.token);
    equal(r.created.length, 1); equal(r.failed.length, 1); equal(r.failed[0].row, 3);
  } finally { done(); }
});

test('over the cap: nothing previewed, nothing created, and it says why', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const text = csv(Array.from({ length: BULK_MAX_ROWS + 1 }, (_, i) => base({ serial: `O-${i}` })));
    const pv = await previewBulk(a.id, text);
    equal(pv.ok, false); assert(/limit is 100/.test(pv.fileProblems[0]));
    await rejects(() => confirmBulk(a.id, text, 'x'), /limit is 100/);
    equal(await count(a.id), 0);
    const exactly = csv(Array.from({ length: BULK_MAX_ROWS }, (_, i) => base({ serial: `E-${i}` })));
    const ok = await previewBulk(a.id, exactly);
    equal(ok.counts.ready, BULK_MAX_ROWS);
  } finally { done(); }
});

test('ISOLATION: the vendor comes from the caller; another vendor\'s preview token is useless and their data unreachable', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha'); const b = await vendor('Bravo');
    const text = csv([base({ serial: 'ISO-1' })]);
    const pa = await previewBulk(a.id, text);
    await rejects(() => confirmBulk(b.id, text, pa.token), /previewed/);
    const ra = await confirmBulk(a.id, text, pa.token);
    // Bravo uploading the identical file gets its own draft, never Alpha's, and Alpha's batch marker is invisible to it.
    const pb = await previewBulk(b.id, text);
    assert(pb.token !== pa.token, 'tokens are per vendor');
    const rb = await confirmBulk(b.id, text, pb.token);
    equal(rb.created.length, 1); equal(rb.already.length, 0);
    equal((await listVendorListings(a.id)).length, 1);
    equal((await listVendorListings(b.id)).length, 1);
    equal(await getVendorListing(b.id, ra.created[0].id), null);
    assert(!JSON.stringify(pb).includes(`MP-${a.id}-`), 'nothing of the other vendor in the preview');
  } finally { done(); }
});

test('the policy gate applies exactly as for a single draft; a restricted vendor cannot import', async () => {
  const { done } = await withTestDb();
  try {
    const v = await createApplication({ legalName: 'Fresh Co', contactEmail: 'fresh@example.com' });
    await decideApplication(v.id, { approve: true, by: 'staff', hstStatus: 'registered' });
    const text = csv([base()]);
    await rejects(() => previewBulk(v.id, text), /policies/);
    await rejects(() => confirmBulk(v.id, text, 'x'), /policies/);
    const a = await vendor('Alpha');
    await query(`UPDATE vendors SET status='restricted' WHERE id=$1`, [a.id]);
    await rejects(() => previewBulk(a.id, text), /cannot list/);
    equal(await count(v.id) + (await count(a.id)), 0);
  } finally { done(); }
});

test('tier limits show in the preview: a probation vendor cannot import Lane C', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const pv = await previewBulk(a.id, csv([base({ lane: 'c' })]));
    assert(pv.rows[0].problems.some((p) => /Standard tier/.test(p.text)), JSON.stringify(pv.rows[0].problems));
  } finally { done(); }
});

test('unrecognised columns are ignored and listed, not fatal', async () => {
  const { done } = await withTestDb();
  try {
    const a = await vendor('Alpha');
    const text = csv([base()]).replace(HEAD[0], `${HEAD[0]}`).split('\n');
    text[0] += ',my_notes'; text[1] += ',hello';
    const pv = await previewBulk(a.id, text.join('\n'));
    equal(pv.ok, true); assert(pv.ignored.includes('my_notes'));
  } finally { done(); }
});
