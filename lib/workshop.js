// The Appliance Repair Workshop — the one place its facts live. The page, the
// application route and the email all read from here, so a date or a price is
// changed once.
//
// Anything null is NOT shown on the page rather than shown as a guess.
export const WORKSHOP = {
  cohort: '2026-11',
  title: 'Appliance Repair Workshop',
  priceLabel: '$2,500',
  priceNote: 'per term (6 weeks)',
  start: '2026-11-14',
  end: '2026-12-19',
  // Nov 14 2026 is a Saturday: six weekly sessions through Dec 19.
  sessions: ['2026-11-14', '2026-11-21', '2026-11-28', '2026-12-05', '2026-12-12', '2026-12-19'],
  timeLabel: null,   // e.g. '10am – 4pm' — not shown until set
  seats: null,       // number — "Only N seats" is not shown until set
  phone: null,       // shown only when set
  weeks: [
    { n: 1, t: 'Foundations & safety', d: 'Electrical and gas safety, tools and the multimeter, reading wiring diagrams and model plates, and a method for diagnosing a fault instead of guessing.' },
    { n: 2, t: 'Refrigeration', d: 'How a fridge and freezer actually cool, defrost systems, fans, seals, thermostats and control boards, and sealed-system work, taught by licensed instructors.' },
    { n: 3, t: 'Washers & dryers', d: 'Drive systems, pumps, bearings, belts, heating elements, venting and error codes.' },
    { n: 4, t: 'Ranges, ovens & cooktops', d: 'Igniters, elements, thermostats and gas valves, with the safety checks that go with them.' },
    { n: 5, t: 'Dishwashers & microwaves', d: 'Inlet valves, pumps, spray arms, latches and leaks. Microwave safety.' },
    { n: 6, t: 'Real-world service', d: 'Live diagnosis on mystery units, sourcing parts, quoting, and talking to customers.' }
  ],
  experience: ['No experience (complete beginner)', 'Some DIY / handy around the house', 'Work in a related trade', 'Already repair appliances'],
  heardFrom: ['Facebook / Instagram', 'Google', 'A friend or family member', 'RS Solutions website', 'Bargain Bay store', 'Other']
};

const TZ = { timeZone: 'America/Toronto' };
// 'YYYY-MM-DD' -> 'Sat, Nov 14'. Noon UTC so the Toronto date can't slip a day.
export function dayLabel(iso, withWeekday = true) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-CA', { ...TZ, month: 'short', day: 'numeric', ...(withWeekday ? { weekday: 'short' } : {}) });
}
