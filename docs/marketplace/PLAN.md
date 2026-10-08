# Bargain Bay Marketplace — Project Plan (A to Z)

Status: **PLAN, nothing built.** Drafted 2026-10-08. Every number marked *(proposal)* is a starting
default for the owner to change. Every legal or regulatory point is marked **[CONFIRM]** — it is my
reading, not legal advice, and needs a lawyer or accountant before launch.

---

## 1. One-page summary

**What:** a curated Marketplace section where approved outside vendors list appliances (and later
adjacent goods) on bargainbay.ca, and use our traffic, Meta catalog, email/SMS and delivery fleet to sell them.

**The central tension.** Bargain Bay's brand is *one-of-a-kind, inspected, one-year warranty, local
delivery*. An open marketplace dilutes that overnight: one bad vendor with a stained "tested working"
fridge costs us more trust than ten good vendors earn. So this is **curated, not open**, and the
product we sell to vendors is not "a place to list" but **"access to our customers plus our logistics and
our trust"**.

**Recommended shape**

| Decision | Recommendation |
|---|---|
| Who may sell | Invite/apply only, manual approval, probation tier first |
| What they sell | Phase 1: appliances only. Phase 3: parts, accessories, install kits |
| Fulfilment | **Two lanes, both on our logistics.** Lane A *Fulfilled by Bargain Bay*: stock comes to our warehouse, we photograph/test/list/deliver. Lane B *Vendor-held, we deliver*: stock stays at the vendor, RS Solutions dispatch picks up and delivers (it already runs transfer jobs). Vendor self-shipping is **deferred** to small goods. |
| Who is seller of record | Vendor is the named seller; Bargain Bay is the payment collector and platform. See §4.3 — CONFIRMED by owner 2026-10-08; HST treatment still to confirm |
| Money | **10% commission at launch** (raised gradually later); customers pay by e-transfer only; ledger-driven payouts by e-transfer. No card payments and no Stripe Connect |
| Rollout | Private beta with 3–5 hand-picked vendors (starting with the existing consignment vendors) → self-serve → automated payouts → growth |

**Why this ordering:** the expensive failure modes (stolen goods, misdescribed units, money owed to the
wrong vendor, one vendor seeing another's data) are all cheaper to find with five vendors we know by
name than with fifty strangers.

---

## 2. Owner decisions (2026-10-08) — THESE OVERRIDE ANYTHING ELSE IN THIS DOCUMENT

| # | Decision | Consequence for the design |
|---|---|---|
| D1 | **Vendor is the seller of record** (the Walmart / Best Buy model). | Vendor named as seller on every listing, invoice and warranty. We are the platform and payment collector, not the seller. HST treatment still **[CONFIRM]** with an accountant. |
| D2 | **No card payments. E-transfer only.** | Stripe Connect is **dropped**, not deferred. Customer e-transfers Bargain Bay; we confirm receipt (existing offline-order / mark-paid flow); we pay vendors from the ledger by **direct deposit or wire** (e-transfer optional) — every vendor must submit banking details at onboarding. Order clock rules: §12.1. |
| D3 | **Every unit carries a ONE-YEAR vendor warranty.** Used units must be classified **Refurbished** and never presented as new. | Warranty is a required field, not optional. "Used" is not a listing condition: a pre-owned unit is listed as Refurbished and must meet the refurbished evidence rules (§6.2). The 90-day idea is dropped. |
| D4 | **Vendor units appear in `/shop` too**, each with a visible "Sold by <Vendor>" note. | Mixed grid from day one, so the quality gates matter more. Cards, product page, cart and invoice all name the seller. |
| D5 | **Commission is 10% at launch**, raised gradually later. | One rate, stored per vendor with effective dates so a later raise never rewrites past sales. Raises need advance notice in the agreement. |
| D6 | **Strict KPI tracking. Accept an order within 24 h. Have it ready for pickup/delivery within 72 h. Three strikes and the vendor is restricted.** | Full SLA clocks, countdowns, scorecard and strike meter on the vendor dashboard (§12.1). |

**Assumptions I made in applying these — please correct any that are wrong:**
1. **Clocks (settled 2026-10-08):** vendors are notified only after we confirm the e-transfer. Both clocks start at that moment: **24 h to accept, 72 h in total to be ready** (or to submit tracking if shipping themselves). A vendor who takes 24 h to accept has 48 h left.
2. Clocks run in **calendar hours**, including weekends. If that is too harsh, the alternative is business hours.
3. A "strike" is one missed deadline or one serious breach. **Strikes never expire on a timer; they come off only by a management revision (owner, 2026-10-08), recorded with who and why.** Restricted means no new sales; orders already paid must still be fulfilled.
4. "Open-box / unused" is still allowed as its own honest label; only *used* units fall under Refurbished.
5. For **new** units, "one year" means the manufacturer warranty is honoured and the vendor backs it for at least a year.

**Resolved (owner, 2026-10-08):**
- **Warranty reserve: 2% of each payout is held for 12 months** (§8.2), released only if no warranty claim is open.
- **Payouts by direct deposit or wire** (e-transfer optional, our limits are high). Vendors **must** submit banking details to be approved (§5.3, §13.4).
- **Delivery fees:** the **customer is charged a delivery fee**, and the **vendor is billed a delivery service fee** (§8.1).
- **Vendors may ship on their own** (Lane C, §4.2), but must submit **tracking within the 72 h window**.
- Strikes expire only through management revision.
- Open-box stays its own honest label.

**Settled (2026-10-08, later):** the 80/20 Lane C delivery-fee split is **confirmed by the owner**. large-appliance deliveries run through the RS Solutions program at our zone rates, with **delivery, haul-away and installation as add-on services** the customer can buy at checkout (these are our services, so they exist only on orders WE deliver — Lanes A/B — not Lane C). **Our insurance covers vendors' goods**, so the §11.7 "insured" option is backed (policy wording still to be confirmed with the broker). A declined-insurance waiver never covers our own gross negligence. **The Lane C 80/20 split is about the customer's delivery fee only:** the customer pays our zone rate, the vendor keeps 80% to cover shipping, Bargain Bay keeps 20%. It has nothing to do with the 10% commission on the item price.

**Also settled (2026-10-08):** out-of-stock cancellations are refunded and count as a strike; the periodic old-strike review list is added (§12.1); vendor insurance accept/decline on units we deliver (§11.7); Lane C is Standard tier and above, the vendor keeps most of the customer's delivery fee, and any vendor who can't ship cheaply asks us to (§4.2).

**Still open:** (a) the vendor delivery service fee amounts — to be set from our real pickup cost per zone (§8.1a); (b) the exact vendor share of the delivery fee in Lane C (80/20 is a proposal); (c) the insurance premium and whether our existing cargo cover reaches vendors' goods — needs a broker (§11.7).

### Original questions (kept for the record; D1–D6 above are now answered)

These were the questions that shaped the draft; the table that follows still reads as originally written.

| # | Question | Recommendation | Why it matters |
|---|---|---|---|
| D1 | **Seller of record**: is the vendor the seller (we take commission) or are we the seller and buy/consign from them (existing consignment model)? | Vendor is seller, we are platform + payment agent | Changes HST, revenue recognition, warranty liability, ledger, and what "Sold by" says. Consignment is simpler legally; commission is a real marketplace |
| D2 | **Card payments are OFF** (Stripe appeal). Marketplace on e-transfer/pay-on-pickup only until that resolves? | Yes — launch Lane A/B on the existing offline-order flow, payouts via ledger + e-transfer | Stripe Connect needs a Stripe account in good standing. Don't design the launch around something we can't turn on |
| D3 | **Warranty**: who stands behind a vendor's used unit? | Vendor minimum 90 days used / manufacturer on new; Bargain Bay "Marketplace Guarantee" fronts claims for 30 days and charges the vendor back; optional **Bargain Bay Certified** (RS Ops tests it, our one-year warranty) as a paid upgrade | Our one-year warranty is the brand. Never promise it on a unit we didn't test |
| D4 | **Mixed or separate grid**: do vendor units appear in `/shop` beside ours, or only under `/marketplace`? | Separate `/marketplace` first, with a "from our marketplace" row on `/shop` once quality is proven | Protects the core store while we learn |
| D5 | **Member/wholesale pricing** on vendor units? | No. Member pricing is cost-based (`lib/pricing.js`) and we don't own vendor cost | A cost floor needs a cost we're entitled to know |
| D6 | **Commission & fees** | See §8 *(proposal)* | Take rate vs vendor acquisition |
| D7 | **Existing consignment vendors (Abi)**: migrate into marketplace or leave as-is? | Leave as-is; offer them the marketplace as an upgrade later | Consignment has live accounting (`consignment_units`, acct 2150) — don't disturb it |
| D8 | Who in the team approves vendors and listings? | Staff (a rep would do this with a vendor on the phone); fees/commission/payout release stay **admin** | Matches the gate rule: customer's sale = staff, business's books = admin |
| D9 | Do we allow **new** items, or used/open-box/refurb only? | Both, clearly labelled; new-in-box needs proof of authorised-dealer source | New is where counterfeit/grey-market risk lives |
| D10 | Geographic scope | Delivery within our existing zones (Pickering/Durham/Scarborough/GTA); no cross-Canada shipping at launch | Appliances are heavy; our zone pricing already exists |

---

## 3. Principles (inherited from how this codebase already works)

1. **Trust is the product.** Every rule below exists to keep "Bargain Bay" meaning something.
2. **One physical unit = one SKU = one row.** The qty-1 reservation lock is sacred (LANDMINE 3). A vendor
   with 12 identical units uploads 12 units; bulk upload expands them. We do not introduce "quantity: 12".
3. **Derived, never typed.** Vendor balances, payouts and stock location are *computed* from append-only
   events (same rule as the ledger journal, a part's on-hand, and a unit's location). No stored balance.
4. **Degrade open for sales, fail closed for money and consent.** A failed lookup must not lose a real
   sale; a failed lookup must never *release a payout* or *send marketing*.
5. **A fixed list beats free text** wherever we will count it (categories, reasons, strikes) — same
   reasoning as `LEAD_SOURCES`.
6. **Recorded unknowns are rows, not gaps.** "Vendor not yet verified" and "no HST number" are visible states.
7. **A library function is not a feature.** Every capability here ships with the screen that calls it.
8. **Every report is reachable** from the nav/hub (`lib/reports.js`), never by typed URL.
9. **Server decides; the browser previews.** Prices, fees, payouts and eligibility are recomputed server-side.
10. **Staging cannot touch real people** (`lib/environment.js`): vendor email/SMS are redirected outside production.

---

## 4. Business model

### 4.1 Roles

| Role | Who | Can do |
|---|---|---|
| Vendor owner | The business | Everything on their own vendor account, incl. bank details, team, closing the account |
| Vendor staff | Their employees | Listings, orders, inbound — **not** bank details or payouts (configurable) |
| Platform staff (`isStaff`) | Our reps | Review applications, moderate listings, handle customer/vendor issues, schedule pickups |
| Platform admin (`isAdmin`) | Owner | Commission rates, payout release, vendor cost/financials, suspensions, policy changes |
| Customer | Shopper | Buys, reviews, opens disputes |

**Vendor access is DATABASE-backed** (`vendor_users`), exactly like `dispatch_access` and `accountant_access`.
A vendor user is on **no** staff list, so every existing admin surface refuses them without knowing the role
exists. *Never put a vendor in `SALES_EMAILS`* — that hands over the whole sales portal.

### 4.2 Fulfilment lanes

**Lane A — Fulfilled by Bargain Bay (recommended default)**
1. Vendor lists; we approve the listing *draft*.
2. Vendor books an **inbound shipment** (ASN): units, dimensions, ready date. Drops at 1135 Squires Beach Rd
   or RS dispatch collects (Lane B logistics, fee applies).
3. Check-in: scan SKU sticker, photograph, verify model/serial against the listing, put-away to a location
   (`lib/locations.js`). Mismatch → hold + vendor notified.
4. Optional **Certification** by RS Ops (test + QA photos) → unlocks "Bargain Bay Certified".
5. Listing goes live only after check-in. *The customer never buys something that isn't physically in our building.*
6. Sale → pick, deliver/pickup from our warehouse using existing dispatch.

**Lane B — Vendor-held, we deliver**
1. Listing goes live after document review + photo review (no physical check-in).
2. Sale → a **transfer job** (`jobs.pickup_*` → customer address) is created on the dispatch board. Pickup
   window agreed with the vendor; driver does a check-out inspection (photos, serial scan) at the vendor's dock.
3. Higher risk (unit not verified by us) so: probation vendors are **not allowed** in Lane B; listing cap per
   trust tier; a driver mismatch (not as described) is a strike.

**Lane C — Vendor ships on their own (ENABLED, owner 2026-10-08).** The vendor arranges the carrier and
delivers to the customer. Rules:
- **Tracking number + carrier must be entered in the dashboard within the 72 h ready window.** Submitting
  valid tracking is what counts as "ready" for this lane; missing it is a missed-deadline strike.
- Carrier from an approved list (freight/white-glove for large appliances; parcel only for items that fit),
  with a tracking number format check and a first-scan check: no carrier movement within 48 h of entry
  → alert to staff and the vendor.
- The unit must be delivered in the same state as described. Damage in transit is the **vendor's** liability.
- Delivery is complete when the **carrier confirms delivery or the customer confirms**; the payout hold period
  starts from that confirmation, not from shipping.
- The customer still gets order tracking in their account; the vendor never receives the customer's phone or
  email, only the delivery address needed for the carrier label.
- No Bargain Bay POD exists in this lane, so require a delivery-confirmation photo/signature from the carrier
  for orders above a value *(proposal $500)*.
- **Lane C is open to Standard tier and above only (owner, 2026-10-08).** Probation vendors use Lanes A/B until
  they have a clean record.
- **Delivery fee in this lane (owner, 2026-10-08):** the customer is charged our standard delivery rate for their
  zone. The vendor keeps **most** of it (proposal: 80% to the vendor, 20% to Bargain Bay). The vendor cannot add a
  surcharge. If it costs them more to ship, that is their problem — the remedy is the **"Ask Bargain Bay to ship
  this"** button, which converts the order to Lane B (Bargain Bay delivers, vendor delivery service fee applies)
  and is only allowed while the 72 h clock is still running.

### 4.3 Seller of record, HST and the money path **[CONFIRM — highest priority legal item]**

**Decided (D1, D2): vendor is seller of record; e-transfer only.** Money path: customer e-transfers Bargain
Bay → staff confirm the deposit and mark the order paid (existing flow) → vendor clocks start → delivery and
POD → hold period → we e-transfer the vendor the net. E-transfer has no chargeback, which protects vendors
and us from card disputes but removes the customer's usual safety net, so the Marketplace Guarantee (§4.4)
carries more weight. Because we hold customers' money between deposit and payout, the "are we a regulated
payment service provider" question is **[CONFIRM]** even without cards.

Option 1 (**recommended**): *Vendor is seller of record. Bargain Bay is the marketplace and collects payment as
the vendor's agent.*
- Customer pays Bargain Bay the full amount (price + HST + delivery).
- Vendor invoices the customer (we generate it on their behalf), charging HST if registered. The vendor's
  HST number is **required** at onboarding; a small supplier below the threshold records "not registered".
- We invoice the vendor for commission + fulfilment fees, **plus HST on our fees**.
- We pay the vendor the net.
- Pros: genuinely a marketplace, our revenue is the commission (clean P&L for the platform).
  Cons: more tax and regulatory surface; holding customers' money for vendors.

Option 2: *Bargain Bay is seller of record; the vendor consigns/sells to us on sale.* This is the existing
consignment model (acct 2150). Simple, but it isn't "vendors selling on our marketplace", the warranty falls
entirely on us, and HST is simply ours.

Things to settle with an accountant/lawyer before building payouts:
- Who charges and remits HST on the vendor's sale; how our commission invoice is taxed; whether any
  CRA **digital-platform-operator reporting** obligations apply to us as the operator (vendors' annual
  payout/identity info). **[CONFIRM]**
- Whether holding funds for third parties makes us a regulated payment service provider
  (Bank of Canada *Retail Payment Activities Act*) — one strong reason to move to **Stripe Connect** (Stripe
  carries that) as soon as card payments are on. **[CONFIRM]**
- Revenue recognition: commission only, versus gross. Matters for the P&L, dashboards and `SALE` predicate.

**Until Connect is available**, payouts are e-transfer from a ledger (below), and we keep a *segregated*
view of "owed to marketplace vendors" (new ledger liability account, sibling of 2150).

### 4.4 Warranty and customer protection (see D3)

| Layer | Who | Terms *(proposal)* |
|---|---|---|
| Manufacturer warranty | Maker | New items only |
| Vendor warranty | Vendor | **Mandatory ONE YEAR on every unit (D3)** — parts & labour for refurbished; for new, manufacturer warranty honoured and backed by the vendor. Stated on the listing; the field cannot be left blank or set lower |
| **Marketplace Guarantee** | Bargain Bay | 30 days: arrives as described, works, not damaged. We refund the customer, then charge the vendor back |
| **RS Ops Inspected** (optional badge, replaces "Certified") | RS Ops | RS Ops tests the unit and keeps the QA record; the warranty is still the vendor's; vendor pays a fee. Now only a trust signal, since every unit already has one year |

**Warranty enforcement (the real risk of D3):** a one-year promise from a vendor is only worth something if
the vendor is still there in month eleven. Mitigations: a claims workflow in the vendor dashboard with
response deadlines (48 h to respond, 7 days to resolve) *(proposal)*; a missed warranty deadline is a strike;
a **warranty reserve** held from payouts (recommended 2% for 12 months) so we can fund a repair or refund
if a vendor vanishes; and the vendor agreement lets us charge the reserve and recover the rest.

---

## 5. Vendors: eligibility, onboarding, trust tiers

### 5.1 Who can apply
- Registered business (Ontario/Canada); sole proprietors allowed with ID.
- Operating in or able to deliver to our zones.
- Not on our blocklist; no unresolved chargeback/fraud history with us.
- Agrees to the Vendor Agreement and policies (§14).

### 5.2 Application (screen: `/marketplace/sell`)
Collect: legal & trading name, business number / HST number (or "not registered"), address, contact,
what they sell, expected monthly volume, source of goods (liquidation, trade-ins, dealer overstock, refurb),
sample listings and photos, references. **Source of goods is a fixed list** (counted, reviewed).

### 5.3 Verification (KYB-lite) — staff checklist
1. Identity of the owner (government ID, matched to the bank account holder).
2. Business existence (registry lookup, website, physical address — a street view of the dock is enough).
3. HST number format check and, when possible, CRA validation. **[CONFIRM]**
4. **Banking information is mandatory (owner, 2026-10-08)** so we can pay by direct deposit or wire: institution,
   transit and account number (or a void cheque / bank letter), stored encrypted with limited access.
   **Account-holder name must match the legal/trading name.** Changes enter a cooling-off period (§13).
5. Proof of source for new-in-box goods (invoice from an authorised distributor).
6. A call or video chat. We are inviting someone into our brand.
7. Result: `approved` (tier 0), `rejected` (with reason, from a fixed list), or `needs_info`.

### 5.4 Trust tiers

| Tier | Entry | Limits *(proposal)* | Payout hold |
|---|---|---|---|
| **0 Probation** | Approved | Lane A only, ≤ 10 live units, every listing human-reviewed | 14 days after delivery, 10% reserve |
| **1 Standard** | 30 days + ≥ 10 clean orders + defect rate < 3% | Lane A+B, ≤ 50 units, AI pre-review + sampled human review | 7 days after delivery |
| **2 Trusted** | 90 days + ≥ 50 orders + < 2% disputes, on-time ≥ 95% | Higher caps, listings auto-publish after automated checks, promo eligibility | 3 days after delivery |

Tier is **computed from performance** (like `mileageReport`: only when both halves are real), with an admin
override that records who and why. Demotion is automatic when thresholds break.

---

## 6. What can be sold

### 6.1 Category taxonomy (fixed list, `MARKET_CATEGORIES` in `lib/constants.js`)
Phase 1 — **Major appliances:** refrigerators (fridge, freezer, wine/beverage), ranges/stoves/cooktops/wall
ovens, dishwashers, washers, dryers (and sets), microwaves/over-the-range, range hoods/vents, built-in
beverage/ice makers, compact appliances.
Phase 1.5 — **Small appliances** (heavier ones only: stand mixers, espresso machines, air fryers) — decide later.
Phase 3 — **Parts & accessories**, install kits (hoses, cords, vents, dryer ducts, mounts), cleaning/maintenance.
Reuse the existing storefront categories and `COLLECTIONS`; do not invent a parallel tree. Marketplace
adds `vendor` and `fulfilment_lane` facets, not new categories.

### 6.2 Condition grading

**Owner rule (D3): a pre-owned unit is listed as REFURBISHED. "Used" is not a vendor choice and a used
unit is never described or priced as new.** To use the Refurbished label the vendor must provide: what was
done (cleaned, tested, parts replaced), the test result and date, and the photos in §7.3. Staff can re-label
a listing from "new" or "open-box" to Refurbished if the evidence says it was used (e.g. wear, installation
marks, missing seals) — and misrepresenting a used unit as new is an **immediate-termination** offence (§14).
The labels remain the existing four on `lib/constants.js`; Refurbished must map onto the existing label that
means it, and the retired terms stay retired.
Vendors must grade into the **existing four condition labels** in `lib/constants.js` — *no fifth label, no
vendor-defined grade.* The retired terms (Scratch & Dent / Tested & Working / Used) must not return via
the marketplace. Each grade has a plain-language definition and a photo requirement (§7.3). Staff can
**re-grade a listing** on review; a repeated pattern of over-grading is a strike.

### 6.3 Prohibited items (cannot be listed, ever)
- Stolen goods, goods with removed/altered/illegible serial or rating plate
- Counterfeit or grey-market goods; unauthorised re-badging
- Recalled items **[CONFIRM against Health Canada recall database]**, items the vendor cannot show are
  safe to sell
- Electrical appliances without certification marks accepted in Ontario (CSA / cUL / equivalent)
  **[CONFIRM with ESA rules]**
- Units with visible fire/flood/biohazard/pest damage; units with missing safety components (door switches,
  anti-tip brackets, gas shutoffs)
- Gas appliances that are not leak-tested and documented; units with open/uncapped gas lines in transport
  **[CONFIRM TSSA obligations for used gas appliances]**
- Refrigeration units with released refrigerant or removed compressors (ozone-depleting-substance rules)
  **[CONFIRM]**
- Anything not an appliance/approved category; services; digital goods; weapons; regulated goods
- Listings that move the customer off-platform (phone/WhatsApp/Marketplace links in text or photos)

### 6.4 Restricted (needs approval or extra evidence)
| Item | Extra requirement |
|---|---|
| New-in-box | Authorised-distributor invoice on file; box photographed with intact seals |
| Gas ranges/dryers | Leak-test record, regulator/hose included, installer-required notice shown |
| Built-in / commercial | Dimensions & cutout specs, voltage/phase stated |
| Refurbished | Describe what was replaced; parts list; test sheet |
| Open-box | Reason for open-box, accessories present list |
| Over $2,500 | Staff review regardless of tier *(proposal)* |
| Water heaters / HVAC | **Out of scope** at launch |

### 6.5 Authenticity & provenance checks
- **Serial number is required** (stored privately) and checked for duplicates across *all* vendors and our own
  tracker (`heldUnitsLike`-style). A serial already live under another seller is blocked and flagged.
- Photo of the rating plate required; model on the listing must match the plate (AI pre-check + human).
- We keep a **stolen-goods protocol**: police request → freeze vendor + unit, preserve records.
- Right-to-inspect clause: we can pull any unit to our warehouse for inspection.

---

## 7. Listing standards

### 7.1 Required fields
| Field | Rule |
|---|---|
| Category | From the fixed list |
| Make, **Model (exact string)** | Typed exactly as on the plate. `data/images.json` and stock photos key on the exact model, so `modelsMatch` tolerance (case, O/0, I/1, ≤3-char revision) is used for *matching*, never to rewrite what the vendor typed |
| Serial | Private; duplicate-checked |
| Condition | One of the four; description of every defect |
| Price (CAD, pre-tax) | Whole or cents; HST added at checkout; delivery separate |
| **Retail / compare-at** | Must be backed by a source URL or invoice for the model; used for "% off". Misleading compare-at pricing is a **Competition Act** risk **[CONFIRM]**. Staff verify. Without it, the badge doesn't show |
| Dimensions (W×D×H), weight | Required — dispatch needs them to quote a crew |
| Colour / finish, fuel/voltage, capacity | Per category template |
| Location lane | A or B; for B, a pickup address and ready windows |
| Included accessories | Checklist |
| Test result | Tested working: yes/no, **how tested** (power-on, full cycle, cooling to temp), date, by whom |
| Warranty offered | Months + what it covers |
| Delivery notes | Stairs, tight turns, install needed |

### 7.2 Title and description rules
- Title format enforced by template: `Make Model — Type, Size/Capacity, Colour` (no ALL-CAPS, no emoji, no
  promo words like "BEST", no price or phone numbers, no other marketplaces).
- Description: plain text; factual; defects stated; no contact info; no claims we cannot back
  ("brand new" on a used item, "certified" unless Certified).
- Sanitised HTML → plain text with paragraphs; no links except manufacturer spec sheets from an allow-list.
- Prohibited in text: off-platform contact, "ask me for a discount", competitor disparagement, shipping
  outside our zones, medical/safety claims.

### 7.3 Photo requirements

**Public gallery (what the customer sees)**

| Requirement | Used / open-box / refurb | New in box |
|---|---|---|
| **Real photos of the actual unit** | Required. Stock photos not allowed as the vendor's images | Vendor photos of the actual box + unit |
| Minimum count | **6** | 4 |
| Required shots | 1 front (full, doors closed) · 2 back/side · 3 interior (doors open) · 4 controls/display **powered on** · 5 every defect close-up (coin/ruler for scale) · 6 accessories | Box label, unit out of box, accessories |
| Resolution | ≥ 1600 px on the long edge (hard floor 1000) | same |
| Format / size | JPG, PNG, WebP, HEIC (converted); ≤ 15 MB each, ≤ 20 per unit | same |
| Framing | Whole item in frame, level, even lighting, neutral uncluttered background | same |
| Forbidden | Watermarks, logos, phone numbers, URLs, text overlays, borders, collages, filters, people/faces, house numbers, pets, images lifted from another site | same |
| Order | Vendor orders their photos; **slide 0 rule** below | |

**Private evidence (never shown publicly):** rating plate (model + serial legible), and for Lane A the
check-in set our staff take. Optional 15–30 s power-on / cycle video (strongly encouraged, and a trust badge).

**Slide order:** the storefront rule "stock photo leads" (§ product gallery in CLAUDE.md) exists to keep the
shop looking like a shop. For marketplace units: the **stock photo leads when we have one for the model**
(consistent grid), and the vendor's real photos follow, each captioned "Photo of the actual unit — from
<vendor>", exactly like the intake photos. If we have no stock photo, the vendor's best front shot leads
and the unit is feed-eligible only after a stock photo exists (same `hasRealImage` rule — do not quietly
promote a vendor photo to the ad).

**Automated checks (on upload, before a human sees it):**
- Dimensions/format/size; strip EXIF *and* GPS; re-encode (kills embedded payloads).
- Blur and exposure scoring; reject below threshold with a plain reason.
- **Perceptual-hash duplicate detection** across vendors and against our own photos — catches stolen photos
  and one unit listed twice.
- OCR / vision pass: phone numbers, URLs, watermarks, faces, plate legibility, "does the photo match the
  stated model/category". Uses Claude vision (the repo already sends PDFs/images to Claude for intake);
  **the model proposes, a human decides** for tier 0–1.
- **Image links are never fetched server-side** (CDNs 403 servers, and it is an SSRF vector) — same rule as
  the Photos tab. Vendors upload files; we do not accept "paste a link".

### 7.4 Listing lifecycle

```
draft → submitted → (auto-checks) → in_review → approved → awaiting_checkin (Lane A) → live
                                       ↓                          ↓
                                    changes_requested          rejected / withdrawn
live → reserved → sold → delivered → (settled)        live → paused | delisted | expired
```
- Every transition writes an event row (who, when, why). Rejections use a **fixed reason list**.
- Price/condition/photo edits on a *live* listing re-enter review (price decreases excepted) — otherwise the
  review can be bypassed by editing after approval.
- Stale listings (not touched in 60 days) are auto-paused; units aged > 45 days become **clearance
  candidates** (vendor opts in to markdown; **no clearance without the vendor's consent**, unlike our own stock).

### 7.5 Bulk upload
CSV template per category + photo ZIP keyed by SKU. Preview-then-commit (like the stop importer): row-level
problems named, blocking vs warning, nothing written until confirmed. Excel error literals blanked; spreadsheet
formulas neutralised (CSV injection). Cap per upload *(300 units, same as intake)*.

---

## 8. Fees, commission and payouts

### 8.1 Fee schedule *(proposal — D6)*

| Fee | Amount | Notes |
|---|---|---|
| Listing | $0 | Pay on sale |
| Commission | **10% of item price (pre-tax) at launch (D5)**, raised gradually; stored per vendor with effective dates; advance notice required | On item only, not delivery or HST |
| Payment processing | Passed through at cost once cards are on | |
| Lane A handling (receive, put-away, list) | **$0 during beta** (10% is the only charge); revisit when the rate is raised | Watch unit economics: 10% of a $400 fridge is $40 |
| **Delivery service fee (billed to vendor)** | Owner decision: yes. **Structure is rethought, see §8.1a.** Deducted from the payout and itemised per order | Pays for OUR work moving the unit. Not charged in Lane C |
| **Shipment insurance (optional, vendor's choice)** | Per order, only when we deliver. See §11.7. Premium is a % of the unit price *(proposal 1.5%)*, deducted from the payout | Vendor must choose accept or decline for every order they accept |
| **Delivery fee (charged to the customer)** | The existing zone-based customer delivery fee (e.g. $79 base) or free pickup at 1135 Squires Beach Rd | Shown at checkout; collected in the e-transfer; never part of commission |
| Warranty reserve | 2% of each payout, held 12 months (§8.2) | Released if no claim is open |
| Lane C (vendor ships) delivery fee | Customer pays our standard zone rate; **vendor keeps most (proposal 80/20)**; no surcharge allowed. Vendor who finds shipping too costly asks us to ship instead | |

#### 8.1a Why a marketplace bills the seller for delivery, and how to calculate ours

**What I could verify about Best Buy:** I could not find a published Best Buy marketplace fee schedule or any
source saying it charges sellers a separate delivery fee. What the sources do say: sellers ship their own
items, and the commission is a category percentage that can include the shipping the seller charges the
customer. Best Buy's own large-appliance delivery is run by Best Buy or its delivery partners, and nothing I
found says marketplace sellers can use it. So I can't tell you how Best Buy calculates a seller-side delivery
fee, and I won't pretend to — if you've seen one on a seller statement, that detail is worth getting from them.
The principle behind any such charge is simple and applies to us regardless:

> The **customer's** fee pays for the last mile (our van to their door). The **vendor's** fee pays for the
> first mile and handling (getting the unit out of the vendor's building and into our hands). They cover two
> different costs, so charging both is not double-dipping.

**Recommended calculation for Bargain Bay (cost-plus, from our own dispatch data):**

| Component | How it is set |
|---|---|
| **Pickup leg (Lane B only)** | By the **vendor's pickup zone**, measured from our Pickering hub — the same zone logic as customer delivery. A vendor's zone is known when they are approved, so their pickup fee is predictable and quoted before they list |
| **Size/handling class** | Standard / oversize (fridge, double wall oven) / two-person-plus — a multiplier on the zone fee, because it decides crew size |
| **Handling (Lane A)** | Receiving, put-away and check-in: a small flat fee per unit, $0 during the beta |
| **Access surcharge** | Optional: stairs, no loading dock, waiting time past the window — from the vendor's own access answers on the listing |
| **Calibration** | Set it so the pickup leg at least covers our real cost per stop. The dispatch Profit tab already shows cost per stop and per driver-day; review quarterly and adjust |

I have **not** put dollar amounts in this time: the earlier $39/$59/$89 were guesses, and the right figures
come from what a pickup actually costs us per zone. Phase 1 should start with a zone × size table you set
once and edit in admin, applied at order time, stored on the order so a later rate change never rewrites a past
statement.
| Certification (RS Ops test + QA) | $39 / unit | Optional |
| Storage | 30 days free, then $2 / unit / day | Stops warehouse becoming vendor free storage |
| Returns | Restocking fee per policy paid by customer where applicable; vendor pays return freight if at fault | |
| Promotion | Free in feeds; paid placement later | |

The **customer** price is the vendor's price; we do not add a hidden markup. The delivery fee is ours.

### 8.2 Payout ledger (derived, append-only)
`vendor_ledger` rows only ever *append*. Balance = `SUM(amount)`; nothing is a stored total.

| Event | Sign | Trigger |
|---|---|---|
| `sale` | + item price | order confirmed |
| `commission` | − | with the sale |
| `fees` | − | handling, pickup, storage, certification |
| `hst_collected` / `hst_on_fees` | tracked separately | per §4.3 |
| `refund` | − | customer refund, incl. restocking logic |
| `chargeback` / `guarantee_claim` | − | Marketplace Guarantee payout |
| `adjustment` | ± | admin only, reason required |
| `payout` | − | when actually paid |
| `reserve_hold` / `reserve_release` | ∓ | probation reserve |

- A payout becomes **eligible** when: order delivered (POD signed) **and** hold period elapsed **and** no open
  dispute/guarantee claim **and** vendor not suspended **and** bank details past cooling-off.
- **Fail closed:** if any eligibility lookup fails, nothing is paid.
- Negative balances (refunds after payout) carry forward and net against future sales; persistent negatives
  go to collections per the Vendor Agreement.
- Payout run is a **proposal screen** an admin approves (like the AP flow: nothing paid without a yes).
- **Payout methods:** direct deposit (EFT) or wire to the vendor's verified account; e-transfer allowed for small
  amounts. A payout file/CSV is generated for the bank, and the paid reference is recorded on the ledger.
- **Warranty reserve (owner, 2026-10-08): 2% of each order's payout is held for 12 months.** Ledger kinds
  `warranty_hold` (− at payout) and `warranty_release` (+ after 12 months from that order's delivery, only when
  no warranty claim is open on the unit). A paid warranty claim debits the held reserve first, then the
  vendor's balance. Reserve released on termination only after the 12 months, never early.
- Order-level fees (commission, delivery service fee) are deducted at payout and shown line by line.
- Statements per period (CSV/PDF), itemised per order, with tax lines. Vendors' HST documents are theirs.
- New ledger accounts: *Owed to marketplace vendors* (liability, sibling of 2150), *Marketplace commission*
  (revenue), *Marketplace fees* (revenue), *Marketplace reserve*. `journal()` derives entries from the
  ledger events; no typed journals.
- **Landmine to avoid:** marketplace sales must **not** flow into the existing `SALE` predicates as gross
  revenue unless D1 says we're seller of record. If we're the agent, the Revenue KPI counts commission; GMV is
  its own figure. Decide before touching analytics (`lib/analytics.js`, `pnl.js`, `books.js`, `ledger.js`
  + `test/sale-predicate.test.mjs` must all agree).

---

## 9. Storefront experience

- **`/marketplace`** landing: curated rows ("Newly listed", "Certified", "Best deals", by category), vendor
  directory, how-it-works, buyer protection explained.
- **Also in `/shop` (D4):** vendor units appear in the main grid and on the home page, each with a visible
  **"Sold by <Vendor>"** line on the card, the product page, the cart and the invoice. Grouping stays
  within a vendor. A buyer must always be able to tell our own stock from a vendor's at a glance.
- **Vendor storefront** `/marketplace/v/<slug>`: name, since-when, verified badge, response/dispatch metrics,
  rating, policies, their live units. No contact details.
- **Product page:** "Sold by <Vendor> · Fulfilled by Bargain Bay" (or "Pickup/delivery arranged by Bargain
  Bay"), condition grade + defects front and centre, gallery with captions identifying photo kind,
  warranty block (vendor warranty + Marketplace Guarantee, or Certified), delivery estimate, return summary.
- **Grouping:** `groupByModel` (lib/group-units.js) must **group within a vendor, not across vendors** —
  two different sellers' condition and warranty are different offers, and a "from $X" card hides who sells
  it. A marketplace card shows "N available · multiple sellers" only on the product page's unit picker.
- **Search/filter facets:** vendor, lane, Certified, condition, category, price, delivery zone.
- **Ratings & reviews:** verified purchasers only, after delivery; rate vendor **and** item/delivery
  separately (a delivery problem shouldn't punish the vendor, and vice versa). Moderation queue; no
  vendor-incentivised reviews; vendors may reply once; no editing a review in return for a refund.
- **SEO:** canonical URLs, structured data (`Product`, `Offer`, `seller`), seoDescription via `lib/specs.js`,
  `noindex` for pending/paused. Vendor pages are indexable.
- **Cart/checkout** (§10) shows "Sold by" per line.
- **Excluded from:** member pricing (D5), clearance engine (unless vendor opts in), site-wide coupons
  (admin may allow per vendor via `coupons.vendor_id` later), the Meta feed until the unit passes feed rules.
- **Trust badges** (computed, never typed by a vendor): Verified Vendor · Certified · On-time delivery ·
  Top rated.

---

## 10. Checkout, orders, reservations

- **Single cart, multi-vendor.** The customer pays once. The order splits into **vendor sub-orders**
  (`order_items.vendor_id` + a `vendor_orders` row per vendor). Our own stock stays untouched in the same cart.
- **Pricing resolved server-side** in `lib/pricing.js`; a marketplace layer is added *beneath* the public price
  (vendor price → platform adjustments like promo/clearance if opted in). Client price is never trusted.
- **Reservations:** reuse `lib/reservations.js` (30-minute SKU holds, race-safe). Vendor SKUs get the same
  lock. Never weaken it.
- **Delivery fee:** computed by zone for the whole drop; one delivery fee per drop, not per vendor, when
  items are co-located in our warehouse (Lane A). For Lane B across multiple vendor locations, the fee is
  per pickup location — shown at checkout. *(Decide the exact rule with dispatch before building.)*
- **HST** per §4.3; invoices: web invoice (`channel='web'`) attaches to the order as today, with a line per
  vendor so the paperwork is itemised.
- **Order states** extend the existing board; a vendor sees only their sub-order states:
  `new → accepted (Lane B) → ready_for_pickup → collected → in_warehouse → out_for_delivery → delivered`.
- **SUPERSEDED by §12.1 (24 h accept / 72 h ready; applies to both lanes):** the earlier draft said: must confirm within 4 business hours or the order is cancelled and the
  vendor gets a strike *(proposal)*. Auto-relists the unit.
- **Cancellation:** vendor cancelling a paid order = strike + fee; customer cancellation follows policy.
- **Fake-order defences** (`lib/antifraud.js`) apply to marketplace SKUs as well: honeypot, rate limits,
  unverified-order sweep. Marketplace SKUs are *more* attractive to a griefing buyer because holds block a
  third party's stock, so caps on units held unpaid per customer/IP are mandatory.
- **Abandoned-checkout sweep** and invoice-bridge guards must treat vendor orders identically — add tests.

---

## 11. Delivery & logistics guidelines

### 11.1 Inbound to our warehouse (Lane A)
1. Book an inbound slot (appointment) — no walk-ins; loading bay hours 10am–8pm.
2. Units labelled with the vendor's reference; we print SKU stickers on check-in.
3. Check-in inspection: model/serial vs listing, visible damage, accessories, **photos at the dock**. Result:
   `accepted`, `accepted_with_note` (price adjust requires vendor consent), `rejected` (returned at vendor's cost).
4. Discrepancies are recorded and the vendor has 48 h to respond before we act per policy.
5. Put-away to a location; unit is "in stock" only after this.

### 11.2 Packing and handing over (Lane B or inbound)
- **Fridges/freezers upright**, doors taped/strapped, rest-time instruction (upright before powering on).
- Cords and hoses bundled and taped to the unit; drain lines emptied; water supply lines drained; dryers' vent
  clean; gas lines capped/disconnected by a qualified person; propane removed.
- Loose racks/drawers secured or boxed; glass/doors protected; clean exterior.
- Weight and dimensions on the listing must be accurate within ±5% — a crew was staffed against them.
- Ground-level access or a loading dock; vendor staff to help load if over 150 lb.
- Pickup windows ≥ 4 hours; vendor must be present; vendor signs the handover on the driver's phone.

### 11.3 Last mile
- Reuse existing dispatch rules: white-glove vs threshold, delivery windows set per job, POD (signature +
  photos), failed-stop reasons, trade-in/haul-away, balance collection.
- **Chain of custody:** photos at vendor collection, at warehouse (if any), and at delivery; any mismatch is
  attributed to the stage where it first appears — that is what makes damage claims decidable.
- Vendor never contacts the customer directly about delivery; we do.
- Delivery SLAs on our side: next-available day within zone *(proposal)*.

### 11.4 Delivery-failure and damage
| Case | Responsibility |
|---|---|
| Damaged at vendor handover (documented) | Vendor |
| Damaged in our transit | Depends on the vendor's insurance choice — see §11.7 |
| Customer not home / wrong address | Customer pays redelivery |
| Unit not as described on arrival | Vendor — guarantee claim |
| Unit missing parts on arrival | Vendor if absent at handover photo; else us |

### 11.7 Shipment insurance for units we deliver (owner, 2026-10-08)

For every order we collect or deliver (Lanes A and B), the vendor **must choose to buy insurance or decline it,
as part of accepting the order.** There is no silent default: the choice, who made it, and when are recorded,
so nobody can later say they did not know. (Lane C: not offered; the vendor's carrier and the vendor carry that
risk.)

| Vendor choice | Damage in OUR transit (collection → delivery) | Premium |
|---|---|---|
| **Insured** | Customer made whole first; the loss is paid by the insurance cover, up to the declared value (the listing price) | % of unit price *(proposal 1.5%)*, deducted from the payout |
| **Declined** | The vendor bears it: the customer is refunded or replaced first, and the loss is charged to the vendor's balance or warranty reserve. We are protected from uninsured shipments | None |

Rules:
- **The customer is always made whole first.** The insurance choice settles who pays *afterwards*; it never
  delays a refund or replacement for the buyer.
- Chain-of-custody photos (§11.3) decide where damage happened. Damage visible at vendor handover is the
  vendor's regardless; damage first visible at delivery is a transit claim.
- Claims must be reported within 48 h of delivery with photos.
- Declining does not cover **our** gross negligence or wilful misconduct — a contract cannot lawfully remove
  that, and the vendor agreement should not pretend to. **[CONFIRM with a lawyer]**
- **Practical prerequisite [CONFIRM with an insurance broker]:** whether RS Solutions' existing cargo/transit
  cover extends to *other businesses' goods* we carry, or whether we need a new policy or a per-shipment
  product. The premium percentage above is a placeholder until a broker prices it. Do not launch Lanes A/B with
  an "insured" option unless a policy really exists behind it.

### 11.5 Returns
- Follow `/policies/returns` incl. the 20% restocking fee where the customer is at fault.
- **Return to the Bargain Bay warehouse, not to the vendor.** We inspect, then credit or relist (with the
  vendor's agreement) or ship back at vendor cost. This keeps a returned unit from vanishing.
- Not-as-described returns: full refund incl. delivery; vendor chargeback.

---

## 12. Vendor dashboard

`/vendor` — own surface (a separate host or path allow-listed in `proxy.js`; decide, mind that
`/api`, `/login` and `/invoice` must stay reachable). Navigation filtered by role (`VendorNav`), like `AdminNav`.

| Module | What it does |
|---|---|
| **Home** | KPIs: live units, sold this month, payout available, open tasks (needs photos, review changes, orders to accept), performance snapshot, announcements |
| **Listings** | Table with status, search/filter, bulk actions; editor with completeness meter; photo manager (reorder, delete, evidence upload); duplicate/clone unit; pause/delist; price change with history |
| **Bulk upload** | CSV + ZIP, preview, problem list, commit |
| **Inbound shipments** | Create ASN, book slot, print manifest, track check-in results, resolve discrepancies |
| **Orders** | Per sub-order: accept/decline (Lane B), pickup window confirmation, ready-to-collect, handover signature, status timeline, customer **first name + suburb only** until collection |
| **Payouts & statements** | Balance (derived), upcoming, history, per-order breakdown, fees, reserve, tax docs, download CSV |
| **Performance** | On-time handover, listing accuracy, defect/dispute rate, cancellation rate, rating, tier & what it takes to move up; strikes with reasons and appeal |
| **Disputes & returns** | Cases, evidence upload, deadlines, outcome |
| **Messages** | Platform-mediated threads with staff (order-scoped). No customer-to-vendor chat with free contact exchange |
| **Promotions** | Opt in to feeds/ads/email features, clearance consent |
| **Account** | Business details, HST number, bank (owner only, MFA re-auth), team members & roles, notification prefs, API keys (later) |
| **Policy centre** | All guidelines, acceptance history, change notices, training checklist |

### 12.1 Service levels, KPI tracker and strikes (D6)

**The rules**

| Rule | Standard | If missed |
|---|---|---|
| **Accept** the order | Within **24 h** of the vendor being notified. The vendor is notified only **after we confirm the e-transfer**, so an unpaid order can never be accepted or struck | Order auto-cancels, unit relists, customer refunded, **1 strike** |
| **Ready** for pickup/delivery (or **tracking submitted** in Lane C) | Within **72 h** of e-transfer confirmation — the same starting moment, so the 72 h includes the 24 h accept window | Customer notified and may cancel for a full refund; **1 strike**; staff escalate |
| **Cancel an order** (e.g. the unit is no longer in stock) | Allowed at any point before handover, with a reason from a fixed list | Customer refunded in full; unit delisted; **1 strike every time, even if honest** (owner, 2026-10-08). Keeping stock accurate is the vendor's job; pausing a listing is free |
| Hand over at the agreed window | Vendor present, unit packed per §11.2 | Re-attempt fee; repeat = **1 strike** |
| Unit as described | Matches listing at check-in/handover | Not-as-described = **1 strike** + chargeback |
| Warranty claims | Respond in 48 h, resolve in 7 days | **1 strike** |

**Three strikes → RESTRICTED.** Restricted means: listings paused, no new sales, already-paid orders must still
be fulfilled, payouts continue under a longer hold. Strikes expire after **90 days** clean *(proposal)*. A
restricted vendor may appeal in writing once; reinstatement is an admin decision and returns them to
probation tier. **Immediate termination** (skip the ladder): selling stolen or counterfeit goods, passing a
used unit off as new, falsifying documents, concealing a safety defect, payout/bank fraud.

**KPI tracker on the vendor dashboard** (the first thing they see):
- **Order clocks:** every open order shows live countdowns *Accept by* and *Ready by*, green → amber (under
  6 h) → red (overdue), with email reminders at 12 h and 20 h without a response and SMS for the final
  hour (time-critical, so allowed on the operations number).
- **Strike meter:** "Strikes: 1 of 3", each with date, reason, order link, expiry date and an appeal button.
- **Scorecard (rolling 30 / 90 days):** average time to accept, % accepted within 24 h, average time to
  ready, % ready within 72 h, cancellation rate, not-as-described rate, warranty response time, return
  rate, rating. Each KPI shows target, actual and trend, and what it takes to move up a tier.
- **Status banner:** Good standing / Warning / At risk (2 strikes) / Restricted.
- Clocks and strikes are computed **server-side from timestamps**, never from what the vendor's browser says.
  A disputed timestamp (e.g. a payment confirmation we were late to record) is corrected by staff and the
  strike withdrawn, with a note — our own delay must never count against a vendor.
- **Periodic strike review list (owner, 2026-10-08).** Because strikes never expire on a timer, an admin-only
  **Strikes awaiting review** queue surfaces every strike older than 90 days, and again every 90 days after
  until a decision is made. For each: the vendor's record since, orders and rating, and the actions *keep* or
  *revise (remove)* — removal needs a written reason and is logged with who did it. The queue appears in the
  Reports hub and as a weekly count on the admin Marketplace dashboard. A removed strike is never deleted: it
  stays visible as "revised" so the history is honest.
- Staff see the same scorecard for every vendor plus a watch-list sorted by risk; the admin Marketplace
  dashboard and Reports hub carry *Vendor performance* and *Overdue orders* cards.

**Notifications:** email (and SMS only for time-critical Lane B accepts) via transactional path — no consent
gate needed, but never marketing content. Staging redirect applies.

---

## 13. Security, privacy, abuse

### 13.1 The biggest risk: tenant isolation
Vendor A must never see vendor B's listings, orders, prices, payouts or customers. This is the failure that
ends the program.
- **Every vendor-facing query takes `vendor_id` from the SESSION, never from the request** (same rule as
  `invoices.created_by`). A route that accepts `?vendor=` is a bug.
- One data-access layer (`lib/vendor-scope.js`) exposes only scoped functions; vendor routes may not import
  `lib/db` directly (enforced by a test that greps the vendor route tree).
- Consider **Postgres row-level security** on vendor tables as a second layer, set per-request. Tests prove
  vendor A cannot read B's rows through every route (PGlite).
- **Own cost never reaches the vendor and vendor cost never reaches non-admins** (the cost-stripping rule).
  Platform margin and other vendors' prices are invisible.

### 13.2 Authentication and sessions
- Separate role, separate cookie scope/audience from `bb_session` so a vendor JWT cannot satisfy staff gates
  (`isStaff`/`isAdmin` remain synchronous and unaffected).
- Passwords: bcrypt as today; **MFA (TOTP) mandatory for owners and for any payout/bank change**.
- Invite-only accounts first; rate-limited login; lockout with notification; session list & revoke.
- Revoking a vendor user keeps the row (`revoked_at/by`) — who had access when is a question that gets asked.
- Impersonation ("view as vendor") exists for staff, is read-only, and is audit-logged.

### 13.3 Uploads
- Images only (magic-byte check, not extension), size caps, server-side re-encode, EXIF/GPS strip, private
  Blob store with keys we choose, served through a proxy route with the same key sanitising as
  `/api/photo` (change both together). Evidence photos are in a separate, non-public prefix.
- CSV: size limit, formula-injection neutralised on export and import, encoding checks.
- Documents (invoices, IDs): private, access-logged, retention policy, never inlined in public pages.
- No server-side fetching of vendor-supplied URLs (SSRF).

### 13.4 Payments and payout fraud
- **Bank detail change → 5-day cooling-off**, notify all vendor users + owner by email, re-verify holder name;
  payouts to the *old* account if the change is within the window and disputed.
- Payout release is admin-only with a four-eyes rule above a threshold *(proposal $2,000)*.
- First payout per vendor is manually verified (small test deposit).
- Velocity checks: sudden spike in listings, price drops to near zero, many cancellations.
- Account-takeover signals: new device + payout change.

### 13.5 Customer privacy (PIPEDA) **[CONFIRM]**
- Vendors see **first name + suburb** until the unit is collected; never email or phone. Full address goes only
  to the driver (RS Solutions), not to the vendor.
- Vendors cannot market to customers: the data-sharing terms forbid it, and marketing consent
  (`consent_events`) is **ours** — a vendor's order does not create consent for the vendor. Our
  `filterAudience` fail-closed gate stays the only door.
- Retention: customer data in vendor views expires N days after delivery.
- Breach plan: who is told, when, and the vendor's duty to report their own incidents.
- Privacy policy and vendor agreement name the roles (we are the controller for customer data; vendors are
  independent recipients for fulfilment only).

### 13.6 Abuse and integrity
| Threat | Control |
|---|---|
| Stolen goods | Serial duplicate check, ID, source proof, police protocol, hold on high-value |
| Counterfeit/new-in-box fraud | Distributor invoice, box/seal photos, sampled inspection |
| Bait-and-switch (photo of good unit, ship worse) | Check-in/handover inspection, serial scan against listing, strikes, chargebacks |
| Fake reviews / self-purchase | Verified-purchase only, same-IP/payment detection, vendor-owned-card detection, velocity |
| Off-platform steering | Text + OCR scan on listings and messages; strike; repeated = removal |
| Price manipulation / fake compare-at | Compare-at verification; price history; sudden-inflation detection |
| Reservation griefing | Per-customer/IP hold caps, honeypot, verification (existing) |
| Vendor undercutting our own stock | Policy question: we don't prohibit it, but we report overlap. Revisit after data |
| Review bombing a vendor | Verified purchase, rate limit, moderation queue |
| Admin/staff misuse | Audit log on every moderation, price change, payout; admin-only adjustments |

### 13.7 Audit and observability
- Append-only `marketplace_events` for every decision (application, review, tier change, strike, price edit,
  payout approval). Immutable; corrections are new rows.
- Sentry tags for `vendor_id`; alerts on payout failures, repeated login failures, moderation backlog.
- Silent failure is the enemy: every scheduled job (payout eligibility, inbound reminders, listing expiry)
  mails the desk when it gives up (throttled), as the CDA/tracker watchers do. *Check env vars before debugging code.*

---

## 14. Policies and documents to write (before launch)

| Document | Audience | Key content |
|---|---|---|
| **Vendor Agreement** (lawyer-reviewed) | Vendor | Independent contractor, seller-of-record terms, commission, payout terms, warranties, indemnity, IP licence for photos, data use, right to inspect, suspension/termination, governing law, dispute process |
| **Seller Code of Conduct** | Vendor | Honest listings, no off-platform dealing, no review manipulation, communication standards |
| **Prohibited & Restricted Items Policy** | Both | §6 in plain language, updated as recalls change |
| **Listing & Photo Standards** | Vendor | §7 with good/bad photo examples (visual guide) |
| **Condition Grading Guide** | Both | Definition + example photos per grade |
| **Fulfilment & Delivery Standards** | Vendor | §11, packing checklist, SLAs |
| **Returns, Warranty & Marketplace Guarantee** | Both | Who pays when |
| **Fees & Payouts Policy** | Vendor | §8 |
| **Enforcement & Appeals** | Vendor | Strike ladder, appeals window |
| **IP / Takedown Policy** | Both | Counterfeit and image-theft reports |
| **Buyer Protection page** | Customer | Plain-language guarantee |
| **Marketplace Terms of Use** (addendum to site terms) | Customer | "Sold by" meaning, our role |
| **Privacy policy update** | Both | Vendors as recipients; PIPEDA language |
| **Vendor Onboarding Guide + 10-min video** | Vendor | First listing in 30 minutes |

**Strike ladder — SUPERSEDED by §12.1 (three strikes, then restricted). The table below is the earlier draft; keep only its "Immediate" row.**

| Strike | Examples | Consequence |
|---|---|---|
| Warning | First minor misdescription, late handover | Coaching note |
| 1 | Not-as-described, cancelled paid order, off-platform contact | Listings paused for review, fee waived |
| 2 | Repeat within 90 days, review manipulation, unauthorised price change | 14-day suspension, payout reserve raised |
| 3 | Pattern, falsified documents | Termination, balance held 90 days |
| Immediate | Stolen goods, counterfeit, fraud, safety concealment | Immediate termination, report to authorities, funds held |

Strikes expire after 12 months clean. Appeals: written, answered in 5 business days, decided by an admin.

---

## 15. Outreach for vendors' products ("use our outreach")

The vendor value proposition: "your units in front of Bargain Bay's customers". Be precise about what that is:

| Channel | Rule |
|---|---|
| **Site placement** | Marketplace landing, category pages, "new arrivals" row for Trusted vendors |
| **Meta catalog** | Add to `/feed` only units passing feed rules (real stock photo, `availability`, price). **THE RULE: feed `id` == pixel `content_ids` == CAPI `contentIds` == SKU** — vendor SKUs obey it. Ads promote *Bargain Bay Marketplace*, not an individual vendor's brand |
| **Email / SMS** | Only to people with valid consent (`filterAudience`, fail-closed). Vendor items may appear in *our* campaigns; vendors cannot send their own |
| **Social** | Featured vendor / unit posts from our channels |
| **Paid** | Phase 4: sponsored placement and co-op ad spend; vendor pays, we disclose "Sponsored" |
| **Search/SEO** | Indexable vendor pages and product pages |

Ad claims must be true: no "tested" or "warranty" claims for uncertified vendor units; compare-at only if
verified **[CONFIRM Competition Act]**. Vendors must opt in to each channel, can opt out per unit, and see
click/view/cart/sale performance for what ran.

---

## 16. Tracking and analytics

### 16.1 Event taxonomy
Server events (source of truth) and browser events; every event carries `vendor_id`, `sku`, `lane`.

| Funnel | Events |
|---|---|
| Vendor acquisition | `vendor_apply_started`, `vendor_applied`, `vendor_approved/rejected`, `vendor_first_login`, `vendor_mfa_enabled` |
| Activation | `listing_started`, `listing_photo_uploaded`, `listing_submitted`, `listing_approved/rejected`, `inbound_booked`, `checkin_complete`, `listing_live`, `time_to_first_listing`, `time_to_first_sale` |
| Demand | `marketplace_view`, `vendor_page_view`, `product_view` (ViewContent), `add_to_cart`, `initiate_checkout`, `purchase` (the existing Meta/CAPI path with SKU ids) |
| Fulfilment | `order_accepted`, `pickup_scheduled`, `collected`, `delivered`, `delivery_failed`, `damage_reported` |
| Money | `payout_eligible`, `payout_approved`, `payout_paid`, `refund`, `guarantee_claim`, `chargeback` |
| Trust | `strike_issued`, `tier_changed`, `review_submitted`, `listing_flagged`, `dispute_opened/resolved` |

### 16.2 Metrics (with definitions, so everyone means the same thing)
- **GMV** (marketplace sales, pre-tax), **take rate** (commission + fees ÷ GMV), **net revenue**.
- **Sell-through** (sold ÷ listed, by cohort and by days live), **median days to sell**.
- **Vendor funnel:** applied → approved → first listing → first sale → repeat.
- **Quality:** listing rejection rate, photo-fail rate, not-as-described rate, return rate, damage rate,
  on-time handover, dispute rate, rating.
- **Supply health:** live units, new listings per week, vendor concentration (top vendor share), vendors active
  in last 30 days.
- **Cannibalisation:** do marketplace sales displace our own stock sales of the same model? Reported, not assumed.
- **Marketing attribution:** `lead_source` is a human answer and `orders.source` is machine attribution —
  marketplace orders get both; do not merge them (see the lead-source section).
- **Unrecorded is a row, not a gap** on every panel.

### 16.3 Where it lives
- Admin: **Marketplace** dashboard (GMV, take, funnel, quality, payouts) on `/admin/marketplace`, plus entries
  in `lib/reports.js`: Vendor performance, Vendor payables aging, Commission & fees, Marketplace quality,
  Disputes. Each card states the question it answers.
- Vendor: their own slice only, never platform totals or other vendors.
- Ads: Pixel/CAPI events use SKU ids; vendor SKUs are `MP-<vendorCode>-<nnn>`.
- Use the product-tracking skills (`design-tracking-plan`, `implement-tracking`) when building, and run the
  tracking-watchdog agent after feature PRs.

---

## 17. Technical architecture

### 17.1 Principles
- **Feature-flagged** (`MARKETPLACE_ENABLED`); dark in production until a vendor is approved.
- **Additive migrations** in `db/migrations/` (0016+). Existing runtime-DDL tables aren't touched.
- **Own modules**, thin routes, tests against PGlite. Plain JS/JSX like the rest.

### 17.2 CRITICAL LANDMINE — the sync deletes what it doesn't know
`upsertProducts` rewrites every product column on every sync and **deactivates anything absent from the
tracker import**, with a 60% guard. Vendor units written into `products` would be silently delisted on the
next sync. Two safe options:
1. **Separate `marketplace_listings` table**, unioned in `lib/inventory.js` at read time (recommended — zero
   risk to the tracker pipeline); or
2. A `source` column on `products` and `upsertProducts` deactivating only `source='tracker'`.
Option 1 also keeps `catalog.json`, `modelsWithoutStockPhoto` and the Stock-gaps/By-vendor reconciliation
(which read the **tracker**) from mistaking vendor stock for missing tracker rows.
**Lane A units are physically ours-to-hold, so they also need a tracker row?** Decision: **no** — the
tracker stays the books for owned stock. Lane A stock gets a warehouse location via `lib/locations.js`
(any SKU accepted) and a marketplace record, but is not on the Master Tracker. Document this so Stock gaps
doesn't treat it as a gap.

### 17.3 Data model (sketch)
```
vendors(id, slug, legal_name, trade_name, business_no, hst_no, hst_status, status, tier,
        source_of_goods, address..., approved_at/by, suspended_at/reason, created_at)
vendor_users(id, vendor_id, user_id, role, mfa_enrolled, revoked_at/by)
vendor_applications(id, vendor_id?, payload jsonb, status, reviewer, reason_code, ...)
vendor_documents(id, vendor_id, kind, blob_key, verified_by/at)            -- private
vendor_bank_accounts(id, vendor_id, token/encrypted, holder_name, verified_at,
                     cooling_until, active)                              -- encrypted at rest
marketplace_listings(id, sku UNIQUE, vendor_id, lane, status, category, make, model,
        serial_private, condition, price, compare_at, compare_at_source, dims, weight,
        attrs jsonb, test_info jsonb, warranty_months, pickup_address..., created_at, ...)
listing_photos(id, listing_id, blob_key, kind[public|evidence], position, phash, caption, checks jsonb)
listing_events(id, listing_id, event, actor, reason_code, at)               -- append-only
inbound_shipments(id, vendor_id, status, slot, units jsonb) / inbound_units(...)
vendor_orders(id, order_id, vendor_id, status, accept_by, handover jsonb, ...)
order_items.vendor_id, order_items.listing_id                             -- additive
vendor_ledger(id, vendor_id, order_id?, kind, amount, ref, at, actor)     -- append-only
vendor_payouts(id, vendor_id, amount, status, approved_by, paid_at, method, ref)
vendor_strikes(id, vendor_id, level, reason_code, evidence, issued_by, expires_at, appeal jsonb)
marketplace_reviews(id, order_item_id, vendor_id, rating_item, rating_delivery, body, status)
marketplace_events(...)                                                   -- audit
policy_acceptances(vendor_id, policy, version, accepted_by, at, ip)
```
Indexes: partial unique on serial among *live* listings (duplicate-serial guard), `(vendor_id, status)`,
`(sku)`. Constraints: ledger `kind` CHECK, no UPDATE/DELETE grants on append-only tables if practical.

### 17.4 Modules and routes
`lib/vendors.js`, `vendor-auth.js`, `vendor-scope.js`, `marketplace-listings.js`, `listing-checks.js`
(photos, serial, text), `marketplace-orders.js`, `vendor-ledger.js`, `payouts.js`, `vendor-performance.js`
(tiers, strikes), `marketplace-reviews.js`, `marketplace-feed.js`.
Routes: `app/marketplace/*`, `app/vendor/*` (+ `app/api/vendor/*`), `app/admin/marketplace/*`
(+ `app/api/admin/marketplace/*`). Cron: `/api/cron/marketplace` (listing expiry, payout eligibility,
reminders, tier recomputation) — its own `vercel.json` entry.

### 17.5 Integration points to verify when building
- `lib/inventory.js` read paths (`getAll/getById/getAvailable/getSiblings`) union listings; `forPanel`
  carries vendor + photos.
- `lib/pricing.js` `decorate()`; `lib/reservations.js` `unavailableSkus`; `/api/checkout` split into
  vendor sub-orders; `lib/web-invoices.js` mirror; `expireReservations` guards stay scoped to `channel<>'web'`.
- Dispatch: `jobFromOrder`/transfer jobs for Lane B; locations for Lane A; POD flows to the vendor order.
- `app/feed/route.js` and Meta ids; `lib/images.js` rules; `/admin/photos` for model stock photos.
- `lib/consent.js` untouched except a note that vendor sales do not create consent.
- `proxy.js` allow-list for the vendor host/paths; `lib/reports.js` for reachability.
- `lib/environment.js` for staging redirects; `test/sale-predicate.test.mjs` if revenue definitions change.

### 17.6 Testing strategy
PGlite integration tests for: tenant isolation (every route as the wrong vendor), reservation races on a
vendor SKU, payout eligibility (including failures → nothing paid), ledger derivation, tier calculation,
duplicate-serial guard, sync does not delist vendor units, grouping within vendor, cost never leaks, staging
never emails real vendors. Security review before each phase; an external pen test before self-serve.

---

## 18. Operations: who does what

| Task | Owner | SLA *(proposal)* |
|---|---|---|
| Review applications | Staff | 2 business days |
| Review listings | Staff (+AI pre-check) | 1 business day (tier 0–1) |
| Inbound check-in | Warehouse / RS Ops | 2 business days from arrival |
| Certification | RS Ops | 3 business days |
| Disputes | Staff, admin on appeal | 3 business days first response |
| Payout run | Admin | Weekly (Thursdays) |
| Performance review & tiers | Auto + admin | Weekly |
| Policy updates | Admin + lawyer | As needed, 14-day notice to vendors |

A weekly **Marketplace review** checks the moderation backlog, strikes issued, top disputes, payout queue.
Moderation queues live under Admin Marketplace; the Reports hub gets the Marketplace cards.

---

## 19. Phased roadmap

Every phase ships with its screens, tests, docs and an exit gate. Sizes are PR-count guesses.

### Phase 0 — Foundations (no code of consequence)  ·  ~2–3 weeks elapsed
- Answer D1–D10. Lawyer: vendor agreement, HST/seller-of-record, platform reporting, RPAA, product safety. **[CONFIRM]**
- Accountant: ledger treatment, commission invoicing.
- Write policies (§14) and photo-standards visual guide.
- Pick 3–5 pilot vendors (conversation, not a form).
- Decide the vendor host/path and the data-isolation approach.
- **Exit:** signed-off model, agreement draft, pilot vendors committed.

### Phase 1 — Assisted beta (staff does the typing)  ·  ~6–8 PRs
- Migrations: vendors, vendor_users, listings, photos, events, orders linkage, ledger.
- `lib/vendors`, listing CRUD, **photo pipeline + checks**, serial duplicate guard.
- Admin: application queue, listing moderation queue, vendor detail, manual ledger/payout entry.
- Storefront: `/marketplace`, vendor page, product page with "Sold by", checkout split, **Lane A only**.
- Inbound check-in flow, warehouse location, labels.
- Sync-safety tests (vendor units survive `upsertProducts`).
- Payouts: **ledger + manual e-transfer**, admin-approved.
- **Exit:** 3–5 vendors, ≥ 50 live units, ≥ 20 delivered orders, 0 isolation findings, ledger reconciles to the cent.

### Phase 2 — Self-serve vendor portal  ·  ~8–10 PRs
- Vendor auth + MFA + team roles, vendor dashboard (Home, Listings, Orders, Payouts, Performance, Policies).
- Bulk upload + preview; inbound booking; messaging; dispute workflow.
- Lane B (vendor-held, dispatch transfer jobs), accept windows, handover signature.
- Tiers + strikes automation; reviews & ratings; marketplace reports in the hub.
- Vendor notifications; policy acceptance versioning.
- External security review / pen test **before** opening applications.
- **Exit:** 15+ vendors, SLAs met 4 weeks running, dispute rate < 3%, no payout errors.

### Phase 3 — Money tooling (e-transfer only — Stripe Connect DROPPED by D2)
- Bank-feed matching of incoming e-transfers to orders, batch payout files, vendor statements, warranty-reserve
  release automation. The paragraph below is the superseded card-era plan; ignore the Stripe/Connect parts.
- Stripe Connect (or equivalent) onboarding for vendors, split payments, automatic payout schedules,
  refund/chargeback handling, tax documents. **[CONFIRM]** regulatory position again.
- Reserve & hold automation; negative-balance handling.
- Categories expansion: parts & accessories, install kits (Lane C).

### Phase 4 — Growth
- Meta/Advantage+ vendor feed, email/SMS featuring, sponsored placement, co-op ads.
- Vendor API + webhooks (inventory sync, order feed), integrations with their systems.
- Certified-by-RS-Ops as a paid product, Marketplace analytics for vendors, seasonal programmes.
- Evaluate vendor-self-ship, wider delivery zones, additional channels.

---

## 20. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Brand damage from a bad vendor | High | Curated entry, probation, Lane A check-in, Guarantee, fast removal |
| Cross-tenant data leak | Critical | Session-scoped access layer, RLS, tests per route, pen test |
| Stolen/counterfeit goods | High | ID + serial checks + provenance + police protocol |
| Payout error / fraud | High | Derived ledger, fail-closed eligibility, admin approval, bank cooling-off |
| Tax/regulatory mistake (HST, platform reporting, payments regulation) | High | Phase 0 legal/accounting; start with ledger model; Connect later |
| Card payments remain OFF | Medium | Launch on offline flow; no Connect dependency before Phase 3 |
| Sync delists vendor stock | High (technical) | Separate listings table + tests (§17.2) |
| Warehouse overload / storage creep | Medium | Caps by tier, storage fee, intake appointments |
| Delivery cost exceeds fees on low-priced units | Medium | Minimum item price, fee schedule, per-zone pickup fees |
| Vendor undercuts or cannibalises our stock | Medium | Measure cannibalisation; policy review after data |
| Support load | Medium | Strong guidelines, templated reasons, self-serve help |
| Fake-order / hold griefing | Medium | Existing antifraud + stricter hold caps |
| Dilution of Meta ads performance | Medium | Feed only vetted units; separate catalog set |
| Our team spreads thin (dispatch + warehouse + intake + support) | **High** | Pilot size cap; hire/assign a marketplace coordinator before Phase 2 |
| Legal liability for unsafe goods | High | Prohibited list, certification marks, recall checks, incident process **[CONFIRM]** |

---

## 21. Success criteria and kill switches

**Phase 1 success:** vendor-listed units sell within a median of 21 days; not-as-described < 3%; payout
disputes 0; average rating ≥ 4.3; net contribution per order positive after handling and delivery.
**Phase 2 success:** vendor onboarding to first listing < 7 days median; moderation SLA met; marketplace
GMV ≥ 20% of total within two quarters *(proposal)*.
**Stop conditions:** a safety incident from a vendor unit; a cross-vendor data exposure; payout errors above
0.5% of payouts; brand NPS dropping on marketplace orders versus ours. Any of these pauses new listings (a
single kill switch: `MARKETPLACE_ENABLED=false`, plus per-vendor suspend).

---

## 22. Things I could not verify (please check)

1. ~~Stripe appeal status~~ — resolved: no card payments (D2). E-transfer limits for high-ticket orders still to check.
2. The **exact four condition labels** and their definitions in `lib/constants.js` — I referenced them by
   rule, not by name.
3. Every item marked **[CONFIRM]**: seller-of-record HST treatment, CRA platform reporting, RPAA, Competition
   Act (compare-at), Consumer Protection Act changes, ESA/CSA certification of used appliances, TSSA for used
   gas appliances, refrigerant rules, Health Canada recall and incident-reporting duties, PIPEDA.
4. Current `products` read paths and `lib/inventory.js` signatures — confirm during Phase 1 design.
5. Whether `/vendor` should be a separate host (like `dispatch.rssolutions.ca`) or a path.
6. Warehouse capacity: how many extra units can Squires Beach hold before storage becomes the constraint?

---

## Appendix A — Condition grading guide (template)
For each of the four existing grades: one-line definition, allowed cosmetic defects (size/location limits),
functional requirement, required photos, example photos. *(Fill from `lib/constants.js` and the site's current
definitions — don't invent new wording that contradicts `/policies`.)*

## Appendix B — Photo checklist by category
- **Fridge/freezer:** front, back, side, interior shelves/drawers, freezer, water/ice dispenser, control panel
  on, door seals, defect close-ups, plate.
- **Range/cooktop:** front, top with burners, oven interior, racks, control panel on, knobs present, plate.
- **Dishwasher:** front, interior racks & spray arms, tub, door seal, control panel, plate.
- **Washer/dryer:** front, drum interior, door gasket, detergent drawer, back (hoses/vent), controls on, plate.
- **Microwave/hood:** front, interior, turntable, controls, mounting bracket, plate.

## Appendix C — Vendor onboarding checklist (staff)
Application read · ID verified · business verified · HST status recorded · bank holder matches · source of
goods reviewed · agreement signed + version · MFA enrolled · first-listing coaching call · tier assigned ·
pickup/inbound slot explained · payout terms explained.

## Appendix D — Reason codes (fixed lists)
Listing rejection: *photos insufficient · photos not of actual unit · model/plate mismatch · condition
overstated · missing defect disclosure · prohibited item · pricing unverifiable · text contains contact info ·
duplicate serial · other (explain)*.
Application rejection: *identity unverifiable · business unverifiable · source of goods · outside scope ·
prior conduct · capacity · other (explain)*.
Strike reasons: *not as described · late/missed handover · cancelled paid order · off-platform contact ·
review manipulation · document falsification · safety concealment · stolen/counterfeit*.
