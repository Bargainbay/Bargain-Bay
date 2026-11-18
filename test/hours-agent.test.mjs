import { suite, test, equal, assert } from './_harness.mjs';
suite('hours-agent key');

const KEY = 'k'.repeat(40);
const mk = (headers = {}, method = 'GET', body) =>
  new Request('http://x/api/hours-agent?range=today', { method, headers, body: body && JSON.stringify(body) });

test('hours key: off with no env, refuses a wrong key, never lets another action through', async () => {
  const { GET, POST } = await import('../app/api/hours-agent/route.js');
  delete process.env.HOURS_AGENT_KEY;
  equal((await GET(mk({ authorization: `Bearer ${KEY}` }))).status, 503);
  process.env.HOURS_AGENT_KEY = KEY;
  equal((await GET(mk())).status, 401);
  equal((await GET(mk({ authorization: 'Bearer nope' }))).status, 401);
  process.env.HOURS_AGENT_KEY = 'short';
  equal((await GET(mk({ authorization: 'Bearer short' }))).status, 503);
  process.env.HOURS_AGENT_KEY = KEY;
  const r = await POST(mk({ authorization: `Bearer ${KEY}` }, 'POST', { action: 'driver_rate', driverId: 1, rate: 99 }));
  equal(r.status, 400);
  assert(/Only shift_create and shift_times/.test((await r.json()).error));
  delete process.env.HOURS_AGENT_KEY;
});
