// Contact details on /checkout are captured however they arrive.
import { suite, test, equal } from './_harness.mjs';
import { watchCheckoutFields } from '../lib/checkout-watch.js';

function page() {
  const target = () => {
    const on = {};
    return {
      addEventListener: (t, f) => { (on[t] ||= []).push(f); },
      removeEventListener: (t, f) => { on[t] = (on[t] || []).filter((x) => x !== f); },
      fire: (t, el) => (on[t] || []).forEach((f) => f({ type: t, target: el }))
    };
  };
  const els = Object.fromEntries(['co-name', 'co-phone', 'co-email', 'co-marketing'].map((id) => [id, { id, value: '', checked: false }]));
  const doc = { ...target(), getElementById: (id) => els[id], activeElement: null, visibilityState: 'visible' };
  const win = target();
  const seen = [];
  const stop = watchCheckoutFields(doc, win, (state, now) => seen.push({ ...state, now }));
  return { doc, win, els, seen, stop, last: () => seen[seen.length - 1] };
}
const autofill = (p) => { p.els['co-name'].value = 'Sam Lee'; p.els['co-phone'].value = '(416) 555-0100'; p.els['co-email'].value = 'sam@example.com'; };

suite('lib/checkout-watch — autofilled details are captured');

test('autofill with focus left on one box reports all three', () => {
  const p = page();
  p.doc.activeElement = p.els['co-name'];
  autofill(p);
  p.doc.fire('input', p.els['co-email']);
  equal(p.last().email, 'sam@example.com');
  equal(p.last().phone, '(416) 555-0100');
  p.doc.fire('change', p.els['co-name']);
  equal(p.last().name, 'Sam Lee');
});

test('leaving or hiding the page reads the boxes with no event at all', () => {
  for (const leave of [(p) => p.win.fire('pagehide'), (p) => { p.doc.visibilityState = 'hidden'; p.doc.fire('visibilitychange'); }]) {
    const p = page();
    autofill(p);
    leave(p);
    equal(p.last().email, 'sam@example.com');
    equal(p.last().now, true);
  }
});

test('half-typed values are not reported', () => {
  const p = page();
  p.doc.activeElement = p.els['co-email'];
  p.els['co-email'].value = 'sam@example.co';
  p.doc.fire('input', p.els['co-email']);
  equal(p.last().email, '', 'the box being typed in is left alone');
  p.els['co-email'].value = 'sam@';
  p.els['co-phone'].value = '416 55';
  p.doc.fire('focusout', p.els['co-email']);
  equal(p.last().email, '');
  equal(p.last().phone, '');
});

test('the marketing box is reported only once touched; other boxes are ignored; stop detaches', () => {
  const p = page();
  p.doc.fire('focusout', { id: 'co-pass' });
  equal(p.seen.length, 0);
  autofill(p);
  p.doc.fire('focusout', p.els['co-email']);
  equal('marketingOptIn' in p.last(), false);
  p.els['co-marketing'].checked = true;
  p.doc.fire('change', p.els['co-marketing']);
  equal(p.last().marketingOptIn, true);
  p.stop();
  const n = p.seen.length;
  p.win.fire('pagehide');
  equal(p.seen.length, n);
});
