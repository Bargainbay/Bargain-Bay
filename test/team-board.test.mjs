// Team board: who sees which channel, and the rules of chat, posts, acks and unread.
import { suite, test, assert, equal } from './_harness.mjs';
import { withTestDb } from './db.mjs';
import { rightsFor } from '../lib/team-board-rules.js';
import {
  sendMessage, listMessages, unreadSummary, markRead, ackPost, postAcks, setPinned, removeMessage, handleTeamRequest
} from '../lib/team-board.js';

const mk = (key, name, groups) => ({ key, name, groups, rights: rightsFor(groups) });
const chans = (m) => Object.keys(m.rights).sort().join(',');

suite('team board — who sees what');
test('CHANNELS FOLLOW THE ROLE', () => {
  equal(chans(mk('a', 'A', ['driver'])), 'delivery,general');
  equal(chans(mk('a', 'A', ['employee'])), 'general,warehouse');
  equal(chans(mk('a', 'A', ['rsops'])), 'general,warehouse');
  equal(chans(mk('a', 'A', ['dispatcher'])), 'delivery,general,warehouse');
  equal(chans(mk('a', 'A', ['staff'])), 'delivery,general,sales,warehouse');
  equal(chans(mk('a', 'A', ['driver', 'employee'])), 'delivery,general,warehouse');
  equal(chans(mk('a', 'A', [])), '');
});
test('ONLY THE OFFICE POSTS IN GENERAL; EVERYONE POSTS IN THEIR OWN CHANNEL', () => {
  assert(!mk('d', 'D', ['driver']).rights.general.post);
  assert(mk('d', 'D', ['driver']).rights.delivery.post);
  assert(!mk('d', 'D', ['driver']).rights.delivery.moderate);
  assert(mk('s', 'S', ['staff']).rights.general.post);
  assert(mk('x', 'X', ['dispatcher']).rights.delivery.moderate);
  assert(mk('x', 'X', ['dispatcher']).rights.warehouse.post, 'dispatch can post in Warehouse');
  assert(!mk('x', 'X', ['dispatcher']).rights.warehouse.moderate, 'but not pin or remove others there');
});

suite('team board — messages (real SQL)');
test('chat, posts, unread, acks, pin and removal', async () => {
  const { done } = await withTestDb();
  try {
    const driver = mk('user:1', 'Rob', ['driver']);
    const rep = mk('user:2', 'Sam', ['staff']);
    const tech = mk('user:3', 'Tia', ['employee']);

    // a driver cannot read or write Sales
    equal((await sendMessage(driver, { channel: 'sales', body: 'hi' })).status, 403);
    equal((await listMessages(driver, { channel: 'sales' })).status, 403);
    // empty and over-long
    equal((await sendMessage(driver, { channel: 'delivery', body: '   ' })).status, 400);
    // a driver cannot post a notice in General, a rep can; a post needs a title
    equal((await sendMessage(driver, { channel: 'general', kind: 'post', title: 'x', body: 'y' })).status, 403);
    equal((await sendMessage(rep, { channel: 'general', kind: 'post', body: 'y' })).status, 400);

    await sendMessage(rep, { channel: 'delivery', body: 'Truck 2 is out of service' });
    const post = await sendMessage(rep, { channel: 'delivery', kind: 'post', title: 'New rule', body: 'Photos at every stop' });
    assert(post.ok);

    // unread counts exclude your own messages
    let u = await unreadSummary(driver);
    equal(u.channels.delivery.chat, 1); equal(u.channels.delivery.post, 1);
    equal(u.channels.sales, undefined);
    equal((await unreadSummary(rep)).channels.delivery.chat, 0);
    // reading moves forward only
    const feed = (await listMessages(driver, { channel: 'delivery' })).messages;
    equal(feed.length, 1);
    await markRead(driver, 'delivery', 'chat', feed[0].id);
    await markRead(driver, 'delivery', 'chat', 0);
    equal((await unreadSummary(driver)).channels.delivery.chat, 0);

    // polling with after
    const m2 = await sendMessage(rep, { channel: 'delivery', body: 'second' });
    equal((await listMessages(driver, { channel: 'delivery', after: feed[0].id })).messages.map((m) => m.id).join(), String(m2.message.id));

    // acks: a member acks once; only moderators see who
    const id = post.message.id;
    await ackPost(driver, id); await ackPost(driver, id);
    equal((await listMessages(driver, { channel: 'delivery', kind: 'post' })).messages[0].ackedByMe, true);
    equal((await postAcks(driver, id)).status, 403);
    equal((await postAcks(rep, id)).acks.length, 1);
    // a tech cannot ack a delivery post
    equal((await ackPost(tech, id)).ok, false);

    // pin is moderators only and floats the post to the top
    const p2 = await sendMessage(rep, { channel: 'delivery', kind: 'post', title: 'Older', body: 'b' });
    equal((await setPinned(driver, id, true)).ok, false);
    assert((await setPinned(rep, id, true)).ok);
    const posts = (await listMessages(driver, { channel: 'delivery', kind: 'post' })).messages;
    equal(posts[0].id, id); equal(posts[0].pinned, true);

    // removal: own yes, other's no unless moderator; the row stays
    equal((await removeMessage(driver, m2.message.id)).ok, false);
    assert((await removeMessage(rep, m2.message.id)).ok);
    equal((await listMessages(driver, { channel: 'delivery' })).messages.length, 1);
    const { query } = await import('../lib/db.js');
    const { rows } = await query('SELECT deleted_by FROM team_messages WHERE id = $1', [m2.message.id]);
    equal(rows[0].deleted_by, 'Sam');
    void p2;

    // the shared handler: no member -> 401; unknown action -> 400
    equal((await handleTeamRequest(null, { method: 'GET', params: {} })).status, 401);
    equal((await handleTeamRequest(rep, { method: 'POST', body: { action: 'nope' } })).status, 400);
  } finally { done(); }
});

test('RATE LIMIT STOPS A FLOOD', async () => {
  const { done } = await withTestDb();
  try {
    const rep = mk('user:9', 'Flood', ['staff']);
    let last;
    for (let i = 0; i < 22; i++) last = await sendMessage(rep, { channel: 'general', body: 'x' + i });
    equal(last.status, 429);
  } finally { done(); }
});

suite('team board — RS Ops identity (real SQL)');
test('RS OPS ROLES MAP TO CHANNELS, AND A PERSON WITH BOTH LOGINS IS ONE PERSON', async () => {
  const { done } = await withTestDb();
  try {
    const { query } = await import('../lib/db.js');
    const { memberFromRsops } = await import('../lib/team-board.js');
    const tech = await memberFromRsops('Pat', 'Tech');
    equal(tech.key, 'rsops:pat'); equal(tech.name, 'Pat (RS Ops)');
    equal(Object.keys(tech.rights).sort().join(), 'general,warehouse');
    equal(Object.keys((await memberFromRsops('Pat', 'sales')).rights).sort().join(), 'delivery,general,sales,warehouse');
    equal(await memberFromRsops('', 'tech'), null);

    // Pat is an RS Solutions employee with an account here: same key as signing in here.
    const tc = await import('../lib/team-clock.js');
    await tc.saveEmployee({ email: 'pat@example.com', name: 'Pat', company: 'rs_solutions' }, 'owner');
    const { rows: [u] } = await query(`INSERT INTO users (email, name, password_hash) VALUES ('pat@example.com','Pat Singh','x') RETURNING id`);
    const same = await memberFromRsops('Pat', 'tech');
    equal(same.key, `user:${u.id}`); equal(same.name, 'Pat Singh');
    // ...but the name match never lends an account's groups
    equal(Object.keys(same.rights).sort().join(), 'general,warehouse');
    // and what they say through RS Ops is theirs when they sign in here
    const sent = await sendMessage(same, { channel: 'warehouse', body: 'from RS Ops' });
    equal((await listMessages(mk(`user:${u.id}`, 'Pat Singh', ['employee']), { channel: 'warehouse' })).messages[0].authorKey, `user:${u.id}`);
    assert(sent.ok);
  } finally { done(); }
});
