// Workshop applications board: junk, spoken-to, and the notes log.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { query } from '../lib/db.js';
import { listApplications, listNotes, setStatus, setSpoken, addNote } from '../lib/workshop-applications.js';

const V = { email: 'Roushi@bargainbay.ca', name: 'Roushi' };
async function app(name) {
  const r = await query(`INSERT INTO workshop_applications (cohort, name, email, phone) VALUES ('2026-11',$1,$2,'4165550100') RETURNING id`, [name, `${name}@x.ca`]);
  return r.rows[0].id;
}
const rejects = async (fn) => { try { await fn(); } catch { return true; } return false; };

suite('workshop applications board');

test('a new applicant is New and not spoken to', async () => {
  const { done } = await withTestDb();
  try {
    const id = await app('a');
    const a = (await listApplications()).find((x) => x.id === id);
    equal(a.status, 'new'); equal(a.spoken_to, false);
  } finally { done(); }
});

test('junk is a status, several at once, and nothing is deleted', async () => {
  const { done } = await withTestDb();
  try {
    const [x, y] = [await app('x'), await app('y')];
    const r = await setStatus([x, y], 'junk');
    equal(r.changed, 2);
    const all = await listApplications();
    equal(all.filter((a) => a.status === 'junk').length >= 2, true);
    assert(await rejects(() => setStatus([x], 'bogus')));
  } finally { done(); }
});

test('logging "spoke" marks them spoken to; "tried" and moving a card do not', async () => {
  const { done } = await withTestDb();
  try {
    const id = await app('b');
    await addNote(id, { kind: 'tried', body: 'No answer' }, V);
    await setStatus([id], 'contacted');
    equal((await listApplications()).find((a) => a.id === id).spoken_to, false);
    await addNote(id, { kind: 'spoke', body: 'Wants the Saturday cohort, asked about financing' }, V);
    const a = (await listApplications()).find((x) => x.id === id);
    equal(a.spoken_to, true); equal(a.spoken_by, 'Roushi'); equal(a.note_count, 2);
    equal(a.last_note, 'Wants the Saturday cohort, asked about financing');
  } finally { done(); }
});

test('notes are newest-first, author from the session, and an empty note is refused', async () => {
  const { done } = await withTestDb();
  try {
    const id = await app('c');
    await addNote(id, { body: 'first' }, V); await addNote(id, { body: 'second' }, V);
    const n = await listNotes(id);
    equal(n[0].body, 'second'); equal(n[0].by_name, 'Roushi');
    assert(await rejects(() => addNote(id, { body: '   ' }, V)));
    assert(await rejects(() => addNote(id, { kind: 'x', body: 'hi' }, V)));
    assert(await rejects(() => addNote(999999, { body: 'hi' }, V)));
  } finally { done(); }
});

test('spoken flag can be toggled off', async () => {
  const { done } = await withTestDb();
  try {
    const id = await app('d');
    await setSpoken(id, true, V);
    equal((await listApplications()).find((a) => a.id === id).spoken_to, true);
    await setSpoken(id, false, V);
    equal((await listApplications()).find((a) => a.id === id).spoken_to, false);
  } finally { done(); }
});

