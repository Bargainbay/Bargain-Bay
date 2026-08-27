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

// After this many failed attempts an item stops being treated as "about to go"
// and starts being treated as a problem: it is shown to the driver, it stops
// holding the stop list hostage, and it is retried slowly in the background
// instead of on every tick.
const GIVE_UP_AFTER = 6;

// Nothing is ever thrown away, but there is no sense hammering. Attempt n waits
// this long after the last try before it is worth another go.
const BACKOFF_MS = [0, 15e3, 45e3, 120e3, 300e3, 600e3];
const backoffFor = (tries) => BACKOFF_MS[Math.min(tries, BACKOFF_MS.length - 1)];

export const isStuck = (row) => (row?.tries || 0) >= GIVE_UP_AFTER;

// What went wrong with the phone's own storage, in words a driver can act on.
// The raw DOMException is useless on a doorstep ("UnknownError") and, worse,
// often has no message at all — which is how the close-out screen ended up
// showing nothing but "Could not save that on the phone."
function storageError(e) {
  const name = e?.name || '';
  if (name === 'QuotaExceededError') {
    return new Error('This phone is out of storage, so the stop could not be saved offline.');
  }
  if (name === 'SecurityError' || name === 'InvalidStateError') {
    return new Error('This browser is blocking offline storage — open the app in Chrome or Safari itself, not inside another app.');
  }
  return new Error(`The phone would not save it (${name || e?.message || 'unknown storage error'}).`);
}

function open() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch (e) { reject(storageError(e)); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'ref' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(storageError(req.error));
    // A second tab (or an install prompt) holding the old version open leaves
    // this hanging forever otherwise, and the driver watches a dead spinner.
    req.onblocked = () => reject(new Error('Offline storage is busy — close the app’s other tabs and try again.'));
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(STORE, mode); } catch (e) { reject(storageError(e)); return; }
    const store = t.objectStore(STORE);
    const out = fn(store);
    t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out);
    t.onerror = () => reject(storageError(t.error));
    t.onabort = () => reject(storageError(t.error));
  });
}

export const newRef = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// Queue an action. `kind` is 'patch' (JSON) or 'complete'/'photos' (multipart
// with blobs).
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

// What the screen needs to know: how much is waiting, and how much of it has
// stopped moving. Never throws — a phone whose storage is broken must still be
// able to draw the stop list.
export async function queueState() {
  try {
    const rows = await pending();
    return { total: rows.length, stuck: rows.filter(isStuck).length, ok: true };
  } catch {
    return { total: 0, stuck: 0, ok: false };
  }
}

export async function drop(ref) {
  const db = await open();
  await tx(db, 'readwrite', (s) => s.delete(ref));
}

async function bump(row) {
  const db = await open();
  await tx(db, 'readwrite', (s) => s.put({ ...row, tries: (row.tries || 0) + 1, lastTry: Date.now() }));
}

// Send one item. Four answers, and the difference between the last two is the
// difference between "the van is in a basement" and "this will never work":
//
//   'sent'    it landed
//   'drop'    the server has judged it — a stop reassigned to somebody else, say
//             — and no amount of retrying will change the answer
//   'retry'   the server answered, badly (5xx, 429, a timeout). Worth another
//             go, and worth COUNTING: enough of these and the phone should stop
//             pretending the office has it.
//   'offline' nothing answered at all. Not the item's fault and never counted
//             against it — a driver with no signal for an hour must not be told
//             their work is failing.
//
// Exported because it is also the escape hatch: when the phone's own storage
// refuses to hold something, the close-out is sent straight down the wire
// instead of being lost.
const verdict = (status) => {
  // 4xx that isn't a timeout is a decision, not a hiccup. Keep 408/429.
  if (status >= 400 && status < 500 && ![408, 429].includes(status)) return 'drop';
  return 'retry';
};

export async function sendNow(row) {
  try {
    if (row.kind === 'patch') {
      const res = await fetch('/api/driver/jobs', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...row.body, ref: row.ref })
      });
      return res.ok ? 'sent' : verdict(res.status);
    }
    const fd = new FormData();
    fd.append('jobId', String(row.jobId));
    fd.append('ref', row.ref);
    for (const [k, v] of Object.entries(row.fields || {})) if (v != null && v !== '') fd.append(k, String(v));
    if (row.signature) fd.append('signature', row.signature, 'signature.png');
    (row.photos || []).forEach((b, i) => fd.append('photos', b, `photo-${i}.jpg`));
    const res = await fetch('/api/driver/jobs', { method: 'POST', body: fd });
    return res.ok ? 'sent' : verdict(res.status);
  } catch {
    return 'offline';        // no signal
  }
}

// Save it on the phone, and if the phone won't, send it now.
//
// The queue was a hard dependency: if IndexedDB refused the write — storage
// full, a browser that won't allow it, Safari losing its database connection
// after the app has sat in a pocket all afternoon — the driver simply could not
// finish the stop, on any amount of signal, for the rest of the day. The phone
// is still tried first (that is what makes a basement work), but a phone that
// can't remember is not a reason to refuse a driver who has five bars.
export async function queueOrSend(item) {
  const row = { ...item, ref: item.ref || newRef(), queuedAt: Date.now(), tries: 0 };
  try {
    await queueAction(row);
    return { queued: true, row };
  } catch (storeErr) {
    const result = await sendNow(row);
    if (result === 'sent' || result === 'drop') return { queued: false, sentDirect: true, row };
    // Neither the phone nor the network would take it. Nothing has been lost —
    // it is all still on the screen — but the driver has to be told.
    throw storeErr;
  }
}

// Push whatever is queued. Safe to call often — on load, when the phone comes
// back online, and after every action.
//
// Items are attempted oldest first and ONE STOP AT A TIME: a payment has to land
// before the completion that follows it on the same stop. What changed is that a
// stop that won't go through no longer takes the rest of the day with it. It
// used to `break` on the first failure, so a single item the server kept
// refusing — a deterministic 500, which this route returns for every error —
// silently froze the entire queue behind it AND froze the stop list, which
// refuses to refresh while anything is waiting. A driver in that state could
// finish stops all afternoon and the office would hear about none of them.
export async function flush() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const s = await queueState();
    return { sent: 0, left: s.total, stuck: s.stuck };
  }
  let rows;
  try { rows = await pending(); } catch { return { sent: 0, left: 0, stuck: 0, storageBroken: true }; }

  let sent = 0;
  // Jobs whose queue is jammed this pass. Order is only ever guaranteed WITHIN
  // one stop, so another stop's work carries on past it.
  const blocked = new Set();
  for (const row of rows) {
    const job = String(row.jobId ?? row.ref);
    if (blocked.has(job)) continue;
    // Not due yet — a failing item is retried on a widening delay rather than
    // on every thirty-second tick.
    if (row.lastTry && Date.now() - row.lastTry < backoffFor(row.tries || 0)) { blocked.add(job); continue; }
    const r = await sendNow(row);
    if (r === 'sent' || r === 'drop') {
      await drop(row.ref).catch(() => {});
      if (r === 'sent') sent += 1;
    } else {
      // Only a real answer counts against the item. A silent connection is the
      // van's problem, not the stop's, and counting it would put a driver who
      // spent the morning in rural Ontario in front of a red "this isn't getting
      // through" banner for work that was perfectly fine.
      if (r === 'retry') await bump(row).catch(() => {});
      blocked.add(job);
    }
  }
  const s = await queueState();
  return { sent, left: s.total, stuck: s.stuck };
}
