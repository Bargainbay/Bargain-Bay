'use client';
import { useState, useEffect, useCallback } from 'react';

const GLOBAL_TEMPLATE = `# Bargain Bay Playbook — how we run, in my words

## About us
We sell tested, name-brand liquidation appliances (one of each unit, 1-year warranty), Hamilton / GTA.

## How we operate (everyone)
- Tone with customers, what we will and won't do, delivery hours / areas: ...
- When to check with me before acting: ...

## How I'd handle common situations
- Write these as "if X, do Y" — the agents will follow them exactly.`;

// Per-department starter prompts so the owner knows what to train each specialist on.
const DEPT_TEMPLATE = {
  sales: `# Sales playbook\n\n- Lowest price I'll accept / haggling room: ...\n- Bundle deals (fridge+stove+dishwasher, etc.): ...\n- Holds & deposits: ...\n- Customer stuck between two units: ...`,
  customer_service: `# Customer Service playbook\n\n- Handling complaints: ...\n- Returns / exchanges / refunds: ...\n- Warranty claims: ...\n- When to escalate to me: ...`,
  delivery_dispatch: `# Delivery playbook (for the drivers)\n\n- Unit damaged on arrival: ...\n- Customer not home: ...\n- Stairs / tight access / doesn't fit: ...\n- Taking payment on delivery: ...\n- Delivery hours / areas: ...`,
  technical_manager: `# Technical playbook\n\n- How I grade condition (new open box / scratch & dent / refurb): ...\n- Worth repairing vs parting out: ...\n- Common will-it-fit / will-it-work answers: ...`,
  accounting_bookkeeping: `# Accounting playbook\n\n- How I confirm money landed before recording a payment: ...\n- e-transfer vs cash vs in person: ...\n- Month-end routine: ...`,
  marketing: `# Marketing playbook\n\n- Brand voice / what I will and won't promote: ...\n- What to push (slow movers, seasonal): ...\n- Channels we use: ...`,
  hr: `# HR playbook\n\n- How I schedule drivers / staff: ...\n- Onboarding a new team member: ...\n- Team policies: ...`
};

export default function PlaybookEditor() {
  const [depts, setDepts] = useState([{ dept: 'global', label: 'Company-wide (all agents)' }]);
  const [dept, setDept] = useState('global');
  const [content, setContent] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Build the department dropdown from the live agent roster.
  useEffect(() => {
    fetch('/api/admin/agents').then((r) => r.json()).then((d) => {
      if (!Array.isArray(d.agents)) return;
      const specialists = d.agents
        .filter((a) => a.dept && a.dept !== 'global')
        .map((a) => ({ dept: a.dept, label: `${a.name} — ${a.title}` }));
      setDepts([{ dept: 'global', label: 'Company-wide (all agents)' }, ...specialists]);
    }).catch(() => {});
  }, []);

  const load = useCallback((d) => {
    setLoaded(false);
    fetch('/api/admin/playbook?dept=' + encodeURIComponent(d))
      .then((r) => r.json())
      .then((res) => { setContent(res.content || ''); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => { load(dept); }, [dept, load]);

  async function save() {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/admin/playbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, dept })
      });
      const d = await r.json();
      setMsg(r.ok ? '✓ Saved — the agents use this within a minute.' : (d.error || 'Could not save.'));
    } catch {
      setMsg('Network error — try again.');
    } finally {
      setBusy(false);
    }
  }

  const template = dept === 'global' ? GLOBAL_TEMPLATE : (DEPT_TEMPLATE[dept] || '');

  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>
        This is how you train the team. The <b>Company-wide</b> playbook is shared by every agent; each department has its
        own section only that specialist sees. Write how the business runs and how you&apos;d handle things — they answer
        your team the way you would. You can also tell any agent in chat (&ldquo;remember that&hellip;&rdquo;) and it files
        the note into its own section automatically.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>Section:</label>
        <select value={dept} onChange={(e) => { setMsg(''); setDept(e.target.value); }} style={{ fontSize: 13.5, padding: '5px 8px' }}>
          {depts.map((d) => <option key={d.dept} value={d.dept}>{d.label}</option>)}
        </select>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={loaded ? template : 'Loading…'}
        rows={18}
        disabled={!loaded}
        style={{ width: '100%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13.5, lineHeight: 1.55, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn accent" onClick={save} disabled={busy || !loaded}>{busy ? 'Saving…' : 'Save section'}</button>
        {loaded && !content && template && <button type="button" className="btn" onClick={() => setContent(template)}>Insert starter template</button>}
        {msg && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{msg}</span>}
      </div>
    </div>
  );
}
