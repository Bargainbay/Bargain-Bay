// The RS Solutions appliance delivery rate sheet as code, and the arithmetic that
// prices one stop from it. NO imports: the browser, the tests and the voice
// manager all read it.
//
// Source: "RS_Solutions_Appliance_Delivery_Rate_Sheet.pdf" (Kitchener rates from
// the CDA base; Tue/Thu/Sat), which the owner attached on 2026-11-16. A reissued
// 2026 sheet (zones $95/$140/$225, gas dryer/range install $250) is recorded in
// OPERATIONS-STATE.md on 2026-11-02; it is kept here as a second sheet so the
// owner can switch with one setting instead of a code change. NEITHER is assumed:
// `sheet` is always named on the quote.
//
// WHAT IS INTERPRETED, and said on every quote rather than hidden:
//   · "Threshold ... 80% of order pricing" is read as 80% of the ZONE rate (the
//     accessorials are charged in full). White glove is 100%.
//   · Distance is DRIVING km from the CDA base. Straight-line km would put a stop
//     in the wrong zone, so an estimate is labelled as an estimate (`estimated`).
//   · "Additions Pcs (after 2)" = $15 for each piece beyond the second on a stop.
//   · "Overweight" = $75 per product over 350 lb. The system holds no weights, so
//     it is only charged when somebody says so; it is listed as a question.

export const RATE_SHEETS = {
  attached: {
    label: 'Rate sheet attached 2026-11-16 (A $85 / B $125 / C $200)',
    zones: [
      { zone: 'A', maxKm: 50, rate: 85 },
      { zone: 'B', maxKm: 100, rate: 125 },
      { zone: 'C', maxKm: 150, rate: 200 }
    ],
    perKmBeyondC: 2,
    thresholdFactor: 0.8,
    extraPieceAfter: 2, extraPiece: 15,
    overweight: 75, overweightLb: 350,
    haulAway: 20, internalMove: 20, fridgeDoorRemoval: 20, homeDoorRemoval: 20,
    installs: {
      laundry: { label: 'Laundry install', rate: 40 },
      stacked_laundry: { label: 'Stacking or pedestal laundry install', rate: 75 },
      dishwasher: { label: 'Dishwasher basic install', rate: 120 },
      wall_oven: { label: 'Electric wall oven install', rate: 175 },
      fridge_waterline_existing: { label: 'Fridge waterline (existing)', rate: 25 },
      fridge_waterline_new: { label: 'Fridge waterline (new, up to 20 ft)', rate: 150 },
      gas_dryer_or_range: { label: 'Gas dryer or range (existing)', rate: 130 },
      otr_microwave: { label: 'OTR microwave or vented rangehood', rate: 125 }
    },
    completion: { bad_address: 1, refused: 1, not_at_home: 0.5, not_at_home_reattempt: 1.5, return_to_vendor: 1, exchange: 2 }
  }
};

// The 2026-11-02 reissue: only the figures the operations note records differ.
RATE_SHEETS.reissue_2026_11_02 = {
  ...RATE_SHEETS.attached,
  label: 'Reissued rate sheet 2026-11-02 (A $95 / B $140 / C $225; other lines assumed unchanged)',
  zones: [
    { zone: 'A', maxKm: 50, rate: 95 },
    { zone: 'B', maxKm: 100, rate: 140 },
    { zone: 'C', maxKm: 150, rate: 225 }
  ],
  installs: { ...RATE_SHEETS.attached.installs, gas_dryer_or_range: { label: 'Gas dryer or range (existing)', rate: 250 } }
};

export const DEFAULT_SHEET = 'reissue_2026_11_02';
export const sheetOf = (key) => RATE_SHEETS[key] || RATE_SHEETS[DEFAULT_SHEET];
const money = (n) => Math.round(n * 100) / 100;

export function zoneForKm(km, sheet = sheetOf()) {
  const k = Number(km);
  if (!Number.isFinite(k) || k < 0) return null;
  // The sheet's bands are whole numbers (0-50, 51-100, 101-150): a driving
  // distance of 50.4 km is still Zone A, 50.6 rounds into B. Round to nearest.
  const r = Math.round(k);
  for (const z of sheet.zones) if (r <= z.maxKm) return { zone: z.zone, rate: z.rate, beyondKm: 0 };
  const last = sheet.zones[sheet.zones.length - 1];
  const beyond = r - last.maxKm;
  return { zone: `${last.zone}+`, rate: money(last.rate + beyond * sheet.perKmBeyondC), beyondKm: beyond };
}

// What a stop's own words say it needs, for an install the crew has not been
// told the type of. ASSUMED, so the quote lists it as a question.
export function guessInstall(text = '') {
  const t = String(text).toLowerCase();
  if (/dishwasher/.test(t)) return 'dishwasher';
  if (/stack|pedestal/.test(t)) return 'stacked_laundry';
  if (/gas/.test(t) && /(dryer|range|stove)/.test(t)) return 'gas_dryer_or_range';
  if (/wall oven/.test(t)) return 'wall_oven';
  if (/otr|over.the.range|microwave|range ?hood/.test(t)) return 'otr_microwave';
  // Washer/dryer with no "stacked" in the text: NOT guessed (owner, 2026-11-17).
  // The caller asks the owner, who confirms from the crew's photos.
  return null;
}

// stop: {
//   km, estimated, pieces, glove: 'threshold'|'white_glove', services: [tags],
//   haulAway (count), internalMove (count), fridgeDoorRemoval (count), homeDoorRemoval (count),
//   overweight (count), installs: [{ type, assumed?, from? }], completion
// }
export function priceDelivery(stop, sheetKey = DEFAULT_SHEET) {
  const sheet = sheetOf(sheetKey);
  const lines = [];
  const questions = [];
  let needsVerification = false;
  const z =zoneForKm(stop.km, sheet);
  if (!z) {
    return { ok: false, sheet: sheetKey, total: null, lines, questions: ['No driving distance from CDA, so no zone and no price.'] };
  }
  if (stop.estimated) questions.push('Distance is a straight-line estimate, not a driving distance, so the zone may be wrong.');

  // Owner, 2026-11-17: these deliveries are all WHITE GLOVE, so that is the default
  // (full zone rate). Only a stop that says 'threshold' gets the 80%.
  const threshold = stop.glove === 'threshold';
  const factor = threshold ? sheet.thresholdFactor : 1;
  lines.push({
    label: `Zone ${z.zone} delivery${z.beyondKm ? ` (${z.beyondKm} km past Zone C at $${sheet.perKmBeyondC}/km)` : ''}${threshold ? ' - threshold, 80%' : ' - white glove'}`,
    amount: money(z.rate * factor)
  });
  if (stop.glove == null) questions.push('Threshold or white glove is not recorded; priced as white glove (full zone rate), which is how these deliveries are billed.');

  const completion = stop.completion && sheet.completion[stop.completion];
  if (completion != null && stop.completion !== 'return_to_vendor' && stop.completion !== 'exchange') {
    // A failed attempt is a percentage of the whole stop, not an extra line.
    const base = lines[0].amount;
    lines[0] = { label: `${lines[0].label} - ${stop.completion.replace(/_/g, ' ')} at ${Math.round(completion * 100)}%`, amount: money(base * completion) };
  }
  const isExchange = stop.services?.includes('exchange') || stop.completion === 'exchange';
  if (isExchange && stop.exchangeBilling === 'haul_away') {
    // CDA exchanges are billed as a haul-away (owner, 2026-11-17), not at the
    // sheet's 200%: an exchange is haul-away x2 ($20 each), always two.
    const n = Number(stop.haulAway) > 0 ? 0 : Math.max(1, Number(stop.exchangeUnits) || 2);
    if (n) lines.push({ label: `Exchange billed as haul away x${n} ($${sheet.haulAway} each)`, amount: money(n * sheet.haulAway) });
  } else if (isExchange) {
    lines[0] = { label: `${lines[0].label} - exchange at 200%`, amount: money(lines[0].amount * sheet.completion.exchange) };
  }
  if (stop.services?.includes('return_pickup') || stop.completion === 'return_to_vendor') {
    lines.push({ label: 'Return to vendor (100% of the forward zone charge)', amount: money(z.rate) });
  }

  const pieces = Number(stop.pieces) || 0;
  if (pieces > sheet.extraPieceAfter) {
    const extra = pieces - sheet.extraPieceAfter;
    lines.push({ label: `${extra} extra piece${extra === 1 ? '' : 's'} after ${sheet.extraPieceAfter} ($${sheet.extraPiece} each)`, amount: money(extra * sheet.extraPiece) });
  }
  const per = (n, rate, label) => { if (Number(n) > 0) lines.push({ label: `${label} x${n} ($${rate} each)`, amount: money(n * rate) }); };
  per(stop.haulAway, sheet.haulAway, 'Haul away');
  per(stop.internalMove, sheet.internalMove, 'Internal move (same floor)');
  per(stop.fridgeDoorRemoval, sheet.fridgeDoorRemoval, 'Fridge door removal');
  per(stop.homeDoorRemoval, sheet.homeDoorRemoval, 'Home door removal');
  per(stop.overweight, sheet.overweight, `Overweight (over ${sheet.overweightLb} lb)`);

  for (const i of stop.installs || []) {
    const def = sheet.installs[i.type];
    if (!def) { questions.push(`Install type "${i.type}" is not on the rate sheet.`); continue; }
    lines.push({ label: `${def.label}${i.assumed ? ' (assumed)' : ''}`, amount: def.rate });
    if (i.assumed) questions.push(`Install priced as "${def.label}" because the stop says "${i.from}". Confirm the type.`);
  }
  if (stop.services?.includes('install') && !(stop.installs || []).length) {
    // Owner rule (2026-11-17): a washer/dryer install is priced as stacked only when
    // the stop SAYS stacked; otherwise it is not guessed. The MANAGER verifies it
    // itself from the delivery crew's photos at end of day, THEN calls the owner to
    // CONFIRM the result - it does not call to ask the owner to verify.
    questions.push('The stop is tagged install but does not say what kind, so no install is charged yet. VERIFY from the crew\'s photos at end of day, then call the owner to CONFIRM (only a stop that says "stacked" is priced as a stacking install).');
    needsVerification = true;
  }
  if (stop.weightUnknown) questions.push('No weights are held, so no overweight charge ($75 per product over 350 lb) is included.');

  const total = money(lines.reduce((s, l) => s + l.amount, 0));
  return { ok: true, sheet: sheetKey, zone: z.zone, km: Math.round(Number(stop.km) * 10) / 10, total, lines, questions, needsVerification };
}
