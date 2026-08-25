'use client';
// The offline queue. Basements, freight elevators and rural stops lose signal,
// and a completion that fails and loses the signature sends drivers back to
// paper — so nothing the driver does is allowed to depend on there being a
// network at that second.
//
// Every action is written to IndexedDB first and sent afterwards. IndexedDB
// rather than localStorage because the queue carries photo and signature BLOBS,
// which localStorage cannot hold. Each item has a `ref` the server uses to
// recognise a replay, so sending twice is safe.

const DB = 'bb-driver';
const STORE = 'outbox';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'ref' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

export const newRef = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// Queue an action. `kind` is 'patch' (JSON) or 'complete' (multipart with blobs).
export async function queueAction(item) {
  const db = await open();
  const row = { ...item, ref: item.ref || newRef(), queuedAt: Date.now(), tries: 0 };
  await tx(db, 'readwrite', (s) => s.put(row));
  return row;
}

export async function pending() {
  const db = await open();
  const rows = await tx(db, 'readonly', (s) => s.getAll());
  return (rows || []).sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function drop(ref) {
  const db = await open();
  await tx(db, 'readwrite', (s) => s.delete(ref));
}

async function bump(row) {
  const db = await open();
  await tx(db, 'readwrite', (s) => s.put({ ...row, tries: (row.tries || 0) + 1, lastTry: Date.now() }));
}

// Send one queued item. Returns 'sent', 'keep' (try again later) or 'drop'
// (the server has judged it — a stop reassigned to someone else, say — and no
// amount of retrying will change the answer).
async function send(row) {
  try {
    if (row.kind === 'patch') {
      const res = await fetch('/api/driver/jobs', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...row.body, ref: row.ref })
      });
      if (res.ok) return 'sent';
      // 4xx that isn't a timeout is a decision, not a hiccup. Keep 408/429.
      if (res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status)) return 'drop';
      return 'keep';
    }
    const fd = new FormData();
    fd.append('jobId', String(row.jobId));
    fd.append('ref', row.ref);
    for (const [k, v] of Object.entries(row.fields || {})) if (v != null && v !== '') fd.append(k, String(v));
    if (row.signature) fd.append('signature', row.signature, 'signature.png');
    (row.photos || []).forEach((b, i) => fd.append('photos', b, `photo-${i}.jpg`));
    const res = await fetch('/api/driver/jobs', { method: 'POST', body: fd });
    if (res.ok) return 'sent';
    if (res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status)) return 'drop';
    return 'keep';
  } catch {
    return 'keep';           // no signal
  }
}

// Push whatever is queued. Safe to call often — on load, when the phone comes
// back online, and after every action.
export async function flush() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { sent: 0, left: (await pending()).length };
  const rows = await pending();
  let sent = 0;
  for (const row of rows) {
    const r = await send(row);
    if (r === 'sent' || r === 'drop') { await drop(row.ref); if (r === 'sent') sent += 1; }
    else { await bump(row); break; }   // still no signal: stop, keep the order
  }
  return { sent, left: (await pending()).length };
}
