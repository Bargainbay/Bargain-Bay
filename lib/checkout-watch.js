// What a shopper has put in the contact boxes on /checkout, however it got there.
// No imports: runs in the browser (components/CartCapture) and in the tests.
//
// Reading only the box that was tapped out of missed autofill: a phone fills
// name, phone and email at once while focus sits on one of them, and the others
// never blur. So every event reads every box, and leaving the page reads them
// one last time.
const FIELDS = { 'co-email': 'email', 'co-phone': 'phone', 'co-name': 'name' };

// Half-typed values are never reported.
const USABLE = {
  email: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v),
  phone: (v) => v.replace(/\D/g, '').length >= 10,
  name: (v) => v.length > 0
};

/**
 * Calls `report(state, now)` as the contact boxes change. `now` is true when the
 * page is being left and there is no time to wait. Returns a stop function.
 */
export function watchCheckoutFields(doc, win, report) {
  const ident = { email: '', phone: '', name: '' };
  let optIn = null;   // null = never ticked; true/false = the box as the shopper left it

  const read = (skip = null) => {
    for (const [id, key] of Object.entries(FIELDS)) {
      const el = doc.getElementById(id);
      if (!el || el === skip) continue;
      const v = String(el.value || '').trim();
      if (USABLE[key](v)) ident[key] = v;
    }
  };
  const tell = (now) => report({ ...ident, ...(optIn === null ? {} : { marketingOptIn: optIn }) }, now);

  // A box was left, or committed (autofill fires change too).
  const onCommit = (e) => {
    const id = e.target?.id;
    if (id === 'co-marketing') {
      // The marketing box is reported the moment it changes, so a shopper who
      // ticks it and then leaves is still on record. Unticking withdraws.
      if (e.type !== 'change') return;
      optIn = !!e.target.checked;
    } else if (!FIELDS[id]) return;
    read();
    tell(false);
  };
  // Autofill without a blur. The box being typed in is left until it is done.
  const onInput = (e) => {
    if (!FIELDS[e.target?.id]) return;
    read(doc.activeElement);
    tell(false);
  };
  const onLeave = () => { read(); tell(true); };
  // Switching apps on a phone hides the page without blurring anything.
  const onHidden = () => { if (doc.visibilityState === 'hidden') onLeave(); };

  const listeners = [
    [doc, 'change', onCommit], [doc, 'focusout', onCommit], [doc, 'input', onInput],
    [doc, 'visibilitychange', onHidden], [win, 'pagehide', onLeave]
  ];
  for (const [t, type, fn] of listeners) t.addEventListener(type, fn);
  return () => { for (const [t, type, fn] of listeners) t.removeEventListener(type, fn); };
}
