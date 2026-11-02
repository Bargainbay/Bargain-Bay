'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

const STATE_LABEL = {
  working: 'Working now',
  asleep: 'Asleep, on schedule',
  warning: 'Latest run failed',
  late: 'Late: no success inside its allowance',
  failing: 'Has run but never succeeded',
  unknown: 'Cannot be seen from here',
  paused: 'Paused on purpose'
};
const DOT = { working: '#2f9e44', asleep: '#4a90d9', warning: '#f08c00', late: '#e03131', failing: '#e03131', unknown: '#7b8794', paused: '#7b8794' };

function ago(iso, now) {
  if (!iso) return 'never recorded';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export default function AgentFloor({ initial }) {
  const [data, setData] = useState(initial);
  const [sel, setSel] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [webgl, setWebgl] = useState(true);
  const mount = useRef(null);
  const village = useRef(null);
  const first = useRef(initial);

  // Poll the same data the health email reads. A failed poll keeps the last picture.
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const r = await fetch('/api/admin/agent-floor', { cache: 'no-store' });
        if (r.ok) { setData(await r.json()); }
      } catch { /* keep the last picture */ }
    }, 20000);
    const c = setInterval(() => setNow(Date.now()), 15000);
    return () => { clearInterval(t); clearInterval(c); };
  }, []);

  useEffect(() => {
    let dead = false; let stop = null;
    (async () => {
      try {
        const { createVillage } = await import('./agent-village-scene.js');
        if (dead || !mount.current) return;
        const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        village.current = createVillage({ mount: mount.current, data: first.current, onPick: (id) => setSel((cur) => (id && id !== cur ? id : null)), reduceMotion: reduce });
        stop = village.current.dispose;
      } catch (e) { console.error('agent village', e); setWebgl(false); }
    })();
    return () => { dead = true; if (stop) stop(); village.current = null; };
  }, []);

  useEffect(() => { village.current?.update(data); }, [data]);
  useEffect(() => { village.current?.select(sel); }, [sel]);

  const [waking, setWaking] = useState(false);
  const [wakeMsg, setWakeMsg] = useState(null);
  useEffect(() => { setWakeMsg(null); }, [sel]);
  async function wake(id) {
    setWaking(true); setWakeMsg(null);
    try {
      const r = await fetch('/api/admin/agent-floor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'wake', id }) });
      const j = await r.json().catch(() => ({}));
      if (j.floor) setData(j.floor);
      setWakeMsg(j.ok ? { ok: true, text: 'It ran, and is carrying its crate to the castle.' } : { ok: false, text: j.error || 'It could not be woken.' });
    } catch { setWakeMsg({ ok: false, text: 'Could not reach the server.' }); }
    setWaking(false);
  }

  const byId = useMemo(() => Object.fromEntries(data.agents.map((a) => [a.id, a])), [data]);
  const cur = sel ? byId[sel] : null;
  const recent = useMemo(() => data.agents.filter((a) => a.lastRunAt).sort((a, b) => b.lastRunAt.localeCompare(a.lastRunAt)).slice(0, 6), [data]);
  const c = data.counts;

  return (
    <div className="av-wrap">
      <style>{CSS}</style>
      <div className="av-stage" ref={mount} aria-label="Village of agents: a castle for the tracker and database, one building per sector, one minion per agent" />
      {!webgl && <div className="av-fallback">This browser could not draw the village. The list below shows the same states.</div>}

      <div className="av-top">
        {data.castle && <span className="av-pill av-castle">Castle Lv {data.castle.level}<span className="av-bar"><i style={{ width: `${data.castle.pct}%` }} /></span><small>{data.castle.into}/{data.castle.need} XP</small></span>}
        <span className="av-pill"><i style={{ background: DOT.working }} />{c.working} working</span>
        <span className="av-pill"><i style={{ background: DOT.asleep }} />{c.asleep} asleep</span>
        <span className={`av-pill${c.attention ? ' av-bad' : ''}`}><i style={{ background: DOT.late }} />{c.attention} need attention</span>
        <span className="av-pill"><i style={{ background: DOT.unknown }} />{c.unknown + c.paused} not visible or paused</span>
      </div>

      <div className="av-side">
        <div className="av-card av-sectors">
          <div className="av-zone">Sectors</div>
          {data.zones.map((z) => (
            <div key={z.key} className="av-sector">
              <b>{z.name}</b><span>Lv {z.level}</span>
              <div className="av-bar"><i style={{ width: `${z.pct}%` }} /></div>
              <small>{Number(z.stat?.n || 0).toLocaleString()} {z.stat?.text}</small>
            </div>
          ))}
        </div>
        {cur && (
          <div className="av-card" role="status">
            <div className="av-zone">{data.zones.find((z) => z.key === cur.zone)?.name}</div>
            <h2>{cur.name}</h2>
            <span className="av-state" style={{ color: DOT[cur.state], borderColor: DOT[cur.state] }}>{STATE_LABEL[cur.state]}</span>
            <p>{cur.what}</p>
            <dl>
              <dt>Schedule</dt><dd>{cur.when}</dd>
              <dt>Last run</dt><dd>{ago(cur.lastRunAt, now)}</dd>
              {cur.level != null && <><dt>Level</dt><dd>{cur.level} &middot; {cur.xp} XP</dd></>}
              {cur.streak != null && <><dt>Clean streak</dt><dd>{cur.streak} {cur.streak === 1 ? 'day' : 'days'}</dd></>}
              {cur.kind === 'cron' && <><dt>Last success</dt><dd>{ago(cur.lastOkAt, now)}</dd><dt>Runs recorded</dt><dd>{cur.runs ?? 'none'}</dd></>}
            </dl>
            {cur.canWake && cur.state !== 'working' && (
              <button type="button" className="av-wake" disabled={waking} onClick={() => wake(cur.id)}>{waking ? 'Waking it\u2026' : 'Wake it up (run now)'}</button>
            )}
            {wakeMsg && <p className={wakeMsg.ok ? 'av-ok' : 'av-err'}>{wakeMsg.text}</p>}
            {cur.error && <p className="av-err">Last error: {cur.error}</p>}
          </div>
        )}
        <div className="av-card av-recent">
          <div className="av-zone">Latest activity</div>
          <ul>
            {recent.map((a) => (
              <li key={a.id}><button type="button" onClick={() => setSel(a.id)}><i style={{ background: DOT[a.state] }} />{a.name}<span>{ago(a.lastRunAt, now)}</span></button></li>
            ))}
            {!recent.length && <li className="av-none">No runs recorded yet.</li>}
          </ul>
        </div>
      </div>

      <div className="av-bottom">
        <div className="av-chips">
          {data.agents.map((a) => (
            <button key={a.id} type="button" className="av-chip" aria-pressed={sel === a.id} onClick={() => setSel(sel === a.id ? null : a.id)}>
              <i style={{ background: DOT[a.state] }} />{a.name}
            </button>
          ))}
        </div>
        <div className="av-foot">Drag to turn, scroll to zoom, click a minion. Updated {ago(data.asOf, now)}; refreshes every 20 seconds.{!data.dbOk && ' Heartbeats could not be read, so jobs show as unknown.'}</div>
      </div>
    </div>
  );
}

const CSS = `
.av-wrap{position:relative;height:min(82vh,780px);min-height:560px;border-radius:14px;overflow:hidden;border:1px solid var(--line,#ddd);background:#bfe3f5;color:#1b2733}
.av-stage{position:absolute;inset:0}
.av-fallback{position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center;background:#eef6fb}
.av-top{position:absolute;top:12px;left:12px;right:12px;display:flex;gap:8px;flex-wrap:wrap;pointer-events:none}
.av-pill{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.92);border:1px solid rgba(27,39,51,.12);border-radius:99px;padding:5px 11px;font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.av-pill i,.av-chip i,.av-recent i{width:9px;height:9px;border-radius:50%;display:inline-block;flex:none}
.av-bad{border-color:#e03131;color:#b02525}
.av-side{position:absolute;top:56px;right:12px;width:min(300px,calc(100% - 24px));display:flex;flex-direction:column;gap:10px;max-height:calc(100% - 150px);overflow:auto}
.av-card{background:rgba(255,255,255,.94);border:1px solid rgba(27,39,51,.12);border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.45}
.av-card h2{margin:2px 0 6px;font-size:20px}
.av-zone{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#5b6b7a;font-weight:600}
.av-state{display:inline-block;border:1px solid;border-radius:99px;padding:1px 9px;font-size:12px;font-weight:600}
.av-card p{margin:8px 0 0}
.av-card dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:10px 0 0}
.av-card dt{color:#5b6b7a}.av-card dd{margin:0;font-variant-numeric:tabular-nums}
.av-err{color:#b02525;word-break:break-word}
.av-recent ul{list-style:none;margin:6px 0 0;padding:0}
.av-recent li button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:5px 0;cursor:pointer;border-top:1px solid rgba(27,39,51,.08)}
.av-recent li:first-child button{border-top:0}
.av-recent li button span{margin-left:auto;color:#5b6b7a;font-variant-numeric:tabular-nums}
.av-recent li button:focus-visible,.av-chip:focus-visible{outline:2px solid #1b2733;outline-offset:2px}
.av-none{color:#5b6b7a}
.av-castle{gap:9px}.av-castle small{color:#5b6b7a;font-weight:500}
.av-bar{display:inline-block;width:70px;height:7px;border-radius:4px;background:rgba(27,39,51,.15);overflow:hidden;vertical-align:middle}
.av-bar i{display:block;height:100%;width:0;background:#2f9e44;border-radius:0}
.av-sectors{display:grid;gap:8px}
.av-sector{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:center}
.av-sector .av-bar{grid-column:1 / -1;width:100%}
.av-sector small{grid-column:1 / -1;color:#5b6b7a}
.av-sector span{font-weight:700;font-variant-numeric:tabular-nums}
.av-wake{margin-top:10px;font:inherit;font-weight:700;color:#fff;background:#2f9e44;border:0;border-radius:8px;padding:9px 14px;cursor:pointer;width:100%}
.av-wake:disabled{opacity:.6;cursor:wait}.av-wake:focus-visible{outline:2px solid #1b2733;outline-offset:2px}
.av-ok{color:#2b7a3a}
.av-bottom{position:absolute;left:12px;right:12px;bottom:10px;display:flex;flex-direction:column;gap:6px}
.av-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:3px;scrollbar-width:thin}
.av-chip{flex:none;display:inline-flex;align-items:center;gap:7px;font:inherit;font-size:12px;color:#1b2733;background:rgba(255,255,255,.92);border:1px solid rgba(27,39,51,.15);border-radius:99px;padding:4px 10px;cursor:pointer}
.av-chip[aria-pressed="true"]{background:#1b2733;color:#fff}
.av-foot{font-size:11px;color:#2c4258;background:rgba(255,255,255,.7);border-radius:6px;padding:3px 8px;align-self:flex-start}
@media (max-width:700px){.av-recent,.av-sectors{display:none}.av-side{top:auto;bottom:92px;max-height:46%}.av-wrap{min-height:520px}}
`;
