'use client';
import { useState, useEffect } from 'react';

// The team roster + the autonomy dial. Each agent starts at "Advise" (asks before
// acting) and the owner ramps it up — to "Routine" (handles clearly-covered work
// on its own) or "Autonomous" (acts in its area, escalates the unusual) — as he
// trusts each one. This is the switch the learning loop is building toward.
const LEVEL_LABEL = {
  advise: 'Advise — asks first',
  routine: 'Routine — handles the routine',
  autonomous: 'Autonomous — acts on its own'
};
const LEVEL_HINT = {
  advise: 'Answers and advises freely; every real action waits for your OK.',
  routine: 'Takes clearly-covered routine actions on its own; still asks on anything unusual or money-sensitive.',
  autonomous: 'Acts in its area on its own and reports back; escalates only the genuinely unusual.'
};

export default function AgentRoster() {
  const [agents, setAgents] = useState([]);
  const [levels, setLevels] = useState(['advise', 'routine', 'autonomous']);
  const [loaded, setLoaded] = useState(false);
  const [savingKey, setSavingKey] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/admin/agents').then((r) => r.json()).then((d) => {
      if (Array.isArray(d.agents)) setAgents(d.agents);
      if (Array.isArray(d.levels)) setLevels(d.levels);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  async function setLevel(agentKey, level) {
    setSavingKey(agentKey); setMsg('');
    setAgents((cur) => cur.map((a) => (a.key === agentKey ? { ...a, autonomy: level } : a)));
    try {
      const r = await fetch('/api/admin/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentKey, level })
      });
      const d = await r.json();
      if (!r.ok) setMsg(d.error || 'Could not update.');
    } catch {
      setMsg('Network error — try again.');
    } finally {
      setSavingKey('');
    }
  }

  if (!loaded) return <p className="hint" style={{ marginTop: 0 }}>Loading the team…</p>;

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        Your AI team. Sarah is the chief of staff — she answers you and routes work to the specialists. Each agent learns
        your way of doing things from its playbook section and from every decision you confirm. Move its <b>autonomy</b> dial
        up when you trust it to handle that work without checking in.
      </p>
      {msg && <div className="error-box" style={{ margin: '0 0 10px' }}>{msg}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {agents.map((a) => (
          <div key={a.key} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '11px 13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <b style={{ color: 'var(--charcoal)' }}>{a.name}</b>
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}> · {a.title}</span>
              </div>
              {savingKey === a.key && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Saving…</span>}
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 8px' }}>{a.blurb}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {levels.map((lv) => (
                <button
                  key={lv}
                  type="button"
                  className={'btn' + (a.autonomy === lv ? ' accent' : '')}
                  style={{ fontSize: 12, padding: '5px 10px' }}
                  title={LEVEL_HINT[lv]}
                  onClick={() => setLevel(a.key, lv)}
                >
                  {LEVEL_LABEL[lv] || lv}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
