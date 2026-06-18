// lib/shipping.js
// Per-model shipping weights (kg) for the Google Merchant Center feed (g:shipping_weight).
// Keys are CANONICAL model numbers: uppercased, only the text before any "/", with
// non-alphanumerics removed and a single leading "Y" (Canadian retail prefix) dropped.
// Researched per model (June 2026); values are approximate product/shipping weights.

const WEIGHTS_KG = {
  // Refrigerators
  MRB19B7AWW: 84, FRMS2733AV: 152, LF24Z6530S: 127, FRSS2323AS: 116,
  GWE22JYMFS: 127, RF25C5551SR: 116, PRSC2222AF: 140, GYE21JYMFS: 122,
  MRFF5033PZ: 125, MSS25N4MKZ: 105, WRFC2036RZ: 123, WRFF3536SZ: 145,
  WRS321SDHZ: 113, GRSC2352AD: 140, GRSS2652AF: 126, DFF101B1BDB: 59,
  FRFN2813AF: 160, FRFS2823AS: 156, FRSS2623AS: 136, GRFG2353AF: 152,
  WRSF5536RW: 129, KRFF305EBS: 140, KRSF705HPS: 137, REF18FCBIPLV: 95,
  REF24FCIPIXL: 127, FRFG1723AV: 100, REF30RCBPNV: 171, REF36FDFZXNT: 132,
  RF29BB8600QLAA: 175, WRFF3136SZ: 147, WRQA59CNKZ: 127, WRFF3536SW: 150,
  KRSF536RPS: 140, WRT134TFDW: 73, WRTX5419SZ: 93, WRT148FZDW: 86,
  WRT148FZDM: 86, WRT541SZDZ: 98,
  // Washers
  ELFW7337AW: 98, GFW650SPNSN: 116, WFC682CLW: 104, WM6998HBA: 118,
  ELFW7437AW: 106, WFW5720RW: 101, WFW6720RR: 105, MHW8630HW: 105,
  NTW4519JW: 57, WTW4000SW: 52, MTW4205SW: 52, WTW5057LW: 68,
  MVW4505MW: 64, MTW5600RW: 68, MTW7205RW: 70, WTW8127LC: 75, MTW7205RF: 70,
  // Dryers
  DVE50BG8300V: 54, WHD560CHW: 79, DLG3601W: 69, DVE53BB8900TAC: 59,
  DVE53BB8900GAC: 59, DVE55A7300E: 54, NED4655EW: 54, MED4205SW: 49,
  WED4105SW: 49, MED6500MBK: 57, WED5050LW: 52, MED5030MW: 52,
  MED5630HW: 54, MED6205RR: 62, WED5620HW: 63, MED7205RW: 61,
  MED7205RR: 61, MED7020RF: 64, MED8630HC: 72,
  // Ranges / wall ovens
  HBL5351UC: 88, F7SP24S1: 92, KFDS936SSS: 189, ACR4303MFW: 85,
  WFES3330RZ: 64, WFES4530SW: 66, WFES4530SB: 66, MFES6030RZ: 77,
  WSES5030SZ: 73, WGE745C0FS: 95, KFEG500EBS: 95, KFED500EBS: 102,
  WSIS5030RV: 104,
  // Dishwashers
  SHEM63W55N: 41, CDT875P2NS1: 62, DD24ST4NX9: 33, SHP78CM5N: 39,
  F4DWS24FI1: 39, WDP540HAMZ: 36, WDF341PAPM: 27, KDFS224SPS: 36,
  WDT740SALW: 45, KDTS324SPS: 36, KDTS224SPS: 36, KDFS424SPS: 36,
  // Microwaves / hoods / other
  WMCS7022RZ: 20, WML75011HV: 29, JMC2430LM: 49, KVUB400GSS: 22,
  CVW73012MSS: 27, PL461912: 27, EPWD257UTT: 23, WDP6B: 24, WET4024HW: 64,
};

// Used only if a unit's model isn't in the table above.
const CATEGORY_FALLBACK_KG = [
  [/refriger|fridge|freezer/i, 110],
  [/dish/i, 35],
  [/wash/i, 75],
  [/dry/i, 35],
  [/range|oven|stove|cook/i, 70],
  [/micro|hood|vent/i, 20],
];

function canon(model) {
  return String(model || "")
    .toUpperCase()
    .split("/")[0]
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^Y(?=[A-Z])/, "");
}

// Returns an integer kilogram weight for a catalogue unit.
export function feedShippingWeightKg(unit) {
  const byModel = WEIGHTS_KG[canon(unit && unit.model)];
  if (byModel) return byModel;
  const hay = `${(unit && unit.category) || ""} ${(unit && unit.title) || ""}`;
  for (const [re, kg] of CATEGORY_FALLBACK_KG) if (re.test(hay)) return kg;
  return 70; // safe default
}
