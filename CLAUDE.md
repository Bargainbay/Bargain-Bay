# CLAUDE.md — Bargain Bay (RS Solutions)

Context for Claude Code working in this repo. Read this first.

## What this is
Bargain Bay is RS Solutions' customer-facing **liquidation appliance storefront** (Pickering/Durham Region/Scarborough/GTA, Ontario, Canada). **Warehouse + pickup: 1135 Squires Beach Rd, Pickering, ON L1W 3T9, open 10am–8pm** (moved from Lynden/Hamilton Jul 2026 — `PICKUP_ADDRESS` / `BUSINESS_ADDRESS` / `BUSINESS_HOURS` in `lib/constants.js` are the source of truth; pickup slot hours live in `lib/pickup.js`). Every unit is **one-of-a-kind (qty 1)** — open-box, scratch & dent, refurbished, tested-working appliances. Custom e-commerce site, **not** Shopify (the Shopify store exists but is under review; this custom build is the live store).

- **Live site:** https://bargainbay.ca (canonical Vercel URL: bargain-bay-two.vercel.app)
- **Repo:** `Bargainbay/Bargain-Bay` (public), default branch `main`, auto-deploys to Vercel on push.
- **Vercel project:** `rs-solutions-inc-s-projects/bargain-bay` (Hobby plan).
- **Stack:** Next.js 14 (App Router), **plain JavaScript/JSX** (no TypeScript), React 18, Postgres (`pg`), Clover Hosted Checkout, `bcryptjs` + `jose` auth, `googleapis` for sheet sync.

## Source of truth & the catalog pipeline
The **master inventory tracker (Google Sheet / `RS Solutions Master Inventory Tracker.xlsx`)** is the source of truth for inventory. It is NOT in this repo. Flow:

```
Master tracker sheet
  → scripts/sync-sheet.mjs (npm run sync, Vercel cron)   [or regenerate from the xlsx]
  → data/catalog.json  { generatedAt, units: [...] }       (one entry per available unit)
  → Next.js storefront
  → checkout → 30-min SKU reservation (Postgres) → Clover Hosted Checkout → webhook → mark sold + writeSold() back to the sheet
```

A unit object: `{ id (SKU), make, model, category, title, condition, price, compareAt (retail) }`. **Sold/reserved units are filtered out at request time from Postgres**, so `data/catalog.json` can lag without overselling.

## Key files
- `lib/pricing.js` — **authoritative price resolver**. Layers: catalog price → clearance markdown → member tier. Used by every storefront page AND `app/api/checkout`. Never trust client price; always resolve here.
- `lib/clearance.js` — clearance layer on a Postgres `clearance` table (sku, price, warranty_months, note, active). Degrades to "no clearance" with no DB.
- `lib/members.js` + `data/member-prices.json` — wholesale/member pricing (see rules below).
- `lib/inventory.js` — `getAll()`, `getById()`, `getAvailable()` (DB-aware), reads `data/catalog.json`.
- `lib/images.js` — `imageFor(unit)`, `hasRealImage(unit)`. Manufacturer photos (AJ Madison CDN) keyed by model via `data/images.json`; falls back to branded per-category placeholder SVG in `public/stock/`. `hasRealImage` is false for placeholders.
- `lib/reservations.js` — race-safe 30-min SKU holds in Postgres. `unavailableSkus()`, `isUnavailable()`.
- `lib/clover.js` — Clover Hosted Checkout. `lib/sheets.js` — read + writeSold via Google service account.
- `lib/auth.js` — bcryptjs + jose JWT cookie `bb_session`. `lib/db.js` — lazy `pg` pool (build never needs `POSTGRES_URL`).
- `lib/constants.js` — HST 13%, $79 delivery, COLLECTIONS, condition labels, `money()`, `pctOff()`. `lib/specs.js` — `seoDescription()`, spec rows. `lib/site.js` — `SITE_URL`.
- `app/` — `page.jsx` (home), `shop/`, `product/[id]/`, `cart/`, `checkout/`, `clearance/`, `order/[orderNumber]/` (status timeline), `track/`, `account/ login/ signup/`, `admin/` (ADMIN_EMAILS-gated order board + reservations + `/api/admin/migrate`), `policies/`, `contact/`, `api/*`.

## Meta / Facebook ads integration (added 2026-06-16)
- `components/MetaPixel.jsx` — base pixel + PageView on route change, rendered in `app/layout.jsx`. Renders nothing if `NEXT_PUBLIC_FB_PIXEL_ID` is unset.
- `lib/fpixel.js` — event helpers (ViewContent, AddToCart, InitiateCheckout, Purchase).
- `components/PixelView.jsx` — ViewContent on product pages. `components/PixelPurchase.jsx` — Purchase (browser + CAPI, shared eventId for dedup) on the confirmed order page.
- `app/api/meta-capi/route.js` — server-side Conversions API (hashes email/phone). Soft-fails if unconfigured; never blocks a page.
- `app/feed/route.js` — **Meta product feed (CSV) at `/feed`**. Reuses catalog + clearance + reservations + images. Columns: `id,title,description,availability,condition,price,sale_price,link,image_link,brand,product_type,google_product_category`. Clearance/discounts show as `sale_price` vs retail `price`. Placeholder-image units are skipped; sold/reserved → `out of stock`.
- **THE RULE:** feed `id` == pixel `content_ids` == CAPI `contentIds` == the unit SKU. If they ever drift, dynamic/Advantage+ catalog ads break.
- Note: there is also a pre-existing Google Shopping feed at `/api/merchant-feed` (RSS). `/feed` is the Meta-tuned one (adds `sale_price`).

### Live Meta asset IDs
- Business portfolio: **Bargain Bay - Shopify**, `business_id=1324307745784770`.
- Pixel / Dataset: **"Bargain Bay's Online Data"**, ID `1485393316082981` → this is `NEXT_PUBLIC_FB_PIXEL_ID`.
- Catalog (owned, NOT Shopify-managed): **"Bargain Bay - Vercel feed"**, Catalog ID `4715561388714620`. Scheduled hourly data feed pulling `https://bargainbay.ca/feed`, currency CAD. Pixel is connected to this catalog.
- Commerce account: "Bargain bay", ID `1061914982830967`.
- Two **Shopify-managed** catalogs also exist (partner-controlled) — do NOT use them for ads; that's exactly the problem we left behind.

## Pricing rules (don't break these)
- **HST 13%**, $79 delivery / free Pickering pickup. CAD throughout. Delivery zones in `/policies/shipping` are distance-from-Pickering (re-anchored Jul 2026; fees unchanged).
- **Member/wholesale:** 55% of retail on regular items (floored at cost+10% via `data/member-prices.json` to keep cost private), and 10% off the clearance price on clearance items. Approval-gated (`role=member`, `member_status=approved`).
- **Clearance keeps the standard ONE-YEAR warranty** (`warranty_months` default 12 — NOT the 3 months that was originally spec'd). Clearance threshold = units aged > 45 days.
- A real bug we already fixed: checkout/cart once charged full catalog price on clearance units. `lib/pricing.js` is now authoritative for both display AND checkout. Keep it that way.

## Environment variables (Vercel → Project → Settings → Environment Variables)
See `.env.example` for the full annotated list. The site builds and browses with none of them set.
- `POSTGRES_URL` — accounts/orders/reservations/admin (Neon).
- `AUTH_SECRET` — login sessions. `ADMIN_EMAILS` — admin gate (comma-separated; admin user id=1 is service@rssolutions.ca).
- `SALES_EMAILS` — **sales-associate gate** (comma-separated). Sales get the Sales dashboard, Quotes, and Invoices (full invoice control: create/send/edit/mark-paid/void/refund) and nothing else. Cost-derived figures are hidden from them: the Profit KPI, the Profit column in sales-by-category, and the per-line cost input on the invoice form. Helpers live in `lib/auth.js`: `isAdmin` / `isSales` / `isStaff` (admin implies sales). **Gate rule: use `isStaff` ONLY on the three selling surfaces + `/api/admin/{invoices,quotes}`; everything else stays `isAdmin`.** Nav is filtered via `<AdminNav salesOnly>` and `<DashboardShell salesOnly>`.
- `SITE_URL` = `https://bargainbay.ca` (used by feed links, canonical, Clover redirects).
- `CLOVER_ENV` / `CLOVER_MERCHANT_ID` / `CLOVER_PRIVATE_TOKEN` — card payments (blank token = pay-on-pickup mode).
- `GOOGLE_CREDENTIALS` / `SHEET_ID` / `GOOGLE_SHEETS_TAB` / `SHEET_WRITEBACK` — sheet sync + sold write-back.
- `NEXT_PUBLIC_FB_PIXEL_ID` = `1485393316082981`, `META_CAPI_ACCESS_TOKEN` = (secret) — Meta pixel + CAPI. Both scoped to Production.
- `RESEND_API_KEY`, `IMAGES_BASE_URL`, `CRON_SECRET` — email, remote photos, cron protection.

## Deploy workflow
Push to `main` → Vercel auto-builds and promotes to Production (bargainbay.ca). DB bootstrap: deploy, sign in with an `ADMIN_EMAILS` account, open `/admin`, click **Run schema migration** (`/api/admin/migrate`, runs `db/schema.sql`, idempotent).

## Invoicing, orders & what counts as revenue (changed 2026-08-22)
An invoice raises its **fulfilment order immediately**, not when it's paid — see
`createAndSendInvoice` in `lib/invoices.js`.

- The order is created `pending_payment`, dated to the **invoice date**, and
  linked via `invoices.order_id`. `markInvoicePaid` flips it to `confirmed`.
- Its units are held off the storefront by a long **reservation**
  (`OFFLINE_HOLD_MINUTES`), not by the order's status — so nothing tells the rest
  of the system the unit is *sold* until the money is actually in.
  `markUnitsSold` (and the tracker's Sold write-back) still happen at payment.
- **Revenue is booked on the invoice date.** `SALE` in `lib/analytics.js` is a
  predicate, not an IN-list: it counts settled orders *plus* a `pending_payment`
  order backed by an `open`/`partial` invoice. Deposits therefore count on the
  day of sale. The Revenue KPI splits "collected · still owing".
- `lib/finance-report.js` keeps its **own cash-basis `SALE`** on purpose — the
  books report money collected. Don't unify the two without deciding which basis
  each surface should use. `lib/customers.js` and `lib/campaigns.js` likewise.
- Void / delete / refund / per-line refund all cancel-or-shrink that order and
  drop its hold, which is what makes the dashboard self-correct.
- `expireReservations` **must** keep excluding invoice-bridged orders. They live
  in `pending_payment` with no `payment_method` until they settle, which is
  exactly the shape the 24h abandoned-checkout sweep cancels.
- The nightly backfill sweep only reaches back `LIVE_BACKFILL_DAYS` (14) for
  unpaid invoices; `backfillAllInvoiceOrders({ all: true })` — the Sync button —
  is the opt-in full pass. Reaching further on a schedule would move historical
  revenue and delist stock behind invoices nobody expects to be paid.

`listInvoices({ q, status, limit, offset })` searches **every** invoice (number,
BB order number, name/email/phone, memo, line description, SKU); `status:
'unpaid'` is the open+partial meta-filter.

**Every sale has an INV number, storefront ones included.** Checkout raises an
invoice with `channel='web'` that ATTACHES to the order it just created
(`attachToOrderId`) rather than raising a second one — a second order would book
the sale twice. It is not emailed: the order confirmation already carries the
same itemisation and e-transfer box.

For a web sale **the order leads and the invoice follows** —
`mirrorOrderToWebInvoice` (in `lib/web-invoices.js`) maps order status onto the
invoice (confirmed/ready/out/delivered→paid, cancelled→void, refunded→refunded)
and does nothing else: no emails, no unit delisting, no writes back to orders.
A `manual` invoice is the opposite — it DRIVES its order — so the mirror only
ever touches `channel='web'` rows. Hooked into `updateOrderStatus`, `refundOrder`,
and the payment webhook.

`lib/web-invoices.js` exists as its own module **only to break an import cycle**
(`lib/invoices.js` imports `lib/orders.js`, so orders/reservations importing the
mirror from invoices.js closed a loop through the checkout path). Keep its
imports to `./db`.

**LANDMINE:** `expireReservations`' 24h abandoned-checkout sweep skips orders
protected by an invoice — that guard MUST stay scoped to
`COALESCE(channel,'manual') <> 'web'`. Every checkout now has an invoice, so
guarding on "has an invoice" would stop the sweep dead and let abandoned card
checkouts hold their unit forever. The sweep also voids the web invoices of the
orders it cancels.

**Every invoice records who raised it.** `invoices.created_by` (email — the stable
identity, matching the `SALES_EMAILS` gate) and `created_by_name` (snapshotted at
creation so the record survives a rename or a departure). Stamped **from the
session, never from the request body** — otherwise one rep could raise an invoice
in another's name. Quote conversions credit whoever converted; Sarah's phone
orders credit `sarah@bargainbay.ca`. The name is also pushed onto the bridged
order's `sales_rep`, which is what the dashboard's per-rep revenue leaderboard
reads — nothing populated that before, which is why the panel was always empty.
The invoice list has a "Raised by" column (click a name to filter) and a rep
filter including "No rep recorded" for invoices predating this.

**Editing a SETTLED invoice is allowed** (`updateInvoice` takes open/partial/paid;
void/refunded are closed records). Correcting an old sale adjusts it **in its own
month** — the bridged order keeps its `created_at` and only its total moves, so a
$1,500 May sale corrected to $1,300 in August moves May by −$200 with no second
record anywhere. Rules that must hold:
- a line kept at a **different price** does NOT move stock. It stays sold and off
  the site; the new price is pushed to `products.sold_price` and the tracker.
- a line **removed** relists its unit + `reverseTrackerSale`; a line **added** sells it.
- crossing the settled line re-syncs stock both ways. Going settled → owing
  un-sells the units but **re-holds everything the invoice still carries** —
  otherwise the edit puts a unit the customer is still buying back on sale.
- status is re-derived from the payment ledger. Paying more than the corrected
  total is reported as `overpaid`; no refund record is invented, because no money
  has physically moved.

## Refunds — three shapes, one ledger (added 2026-08-26)
`/admin/invoices/<INV>/refund` is the whole refund surface (`RefundControl`).
Every path writes an `invoice_refunds` row, moves `invoices.refund_total`, and
takes the money **off the bridged order**, which is what makes the correction
land in the month of the ORIGINAL sale with no second record anywhere.

- `refundInvoiceItems` — the unit(s) came back: relisted, `reverseTrackerSale`,
  their money off the order.
- `refundInvoice` — the whole remaining balance. **Cancels the order** (that's
  what takes a fully reversed sale out of revenue even when the invoice is
  service-only).
- `refundInvoiceAmount` — **money only, moves no stock, ever.** A price
  adjustment after the fact, a goodwill credit, a deposit handed back. Capped at
  what was actually collected less what has already gone back (a `paid` invoice
  predating the payment ledger falls back to its total). The figure typed is
  what leaves the bank, so it is treated as **tax-inclusive** when the invoice
  charged HST and the order's subtotal/HST both move by their share. It posts to
  the order as its own negative line. Available on a `partial` invoice too —
  handing a deposit back used to require voiding the sale.

**The restocking fee (`RESTOCKING_FEE_PCT` = 20, the published policy in
`/policies/returns`) is money we KEEP, so it must stay booked as revenue.** The
returned line comes off the order and a `Restocking fee (20%)` line goes on in
its place; the order still totals what we actually earned. HST follows the money
on both halves — a restocking fee is itself a taxable supply in Ontario.

**LANDMINE — why the full and per-line paths cross over each other.** A full
refund *without* a fee cancels the order. A full refund *with* one cannot: that
would erase the fee. So `refundInvoice` with a `restockingPct` hands off to
`refundInvoiceItems` over every un-refunded line, and that path closes the
invoice out itself (`isFull`). They do not recurse — `refundInvoiceItems` only
calls back when **no** fee is kept. Keep the split: the per-line arithmetic works
off the LINES, and that is the only thing that stops a fee kept on an earlier
partial return from being refunded back out on a later one (totals-based maths
treats the retained fee as refundable and gives 80% of it away).

Refunds are **not** exposed to Sarah with a fee — `refund_invoice` still calls
both functions with the default 0%. Keeping a fifth of a customer's money is the
owner's call, not the phone agent's.

## Coupons & affiliates (added 2026-08-26)
`/admin/coupons` (ADMIN only — a coupon changes what the storefront charges,
which is not a selling-surface permission). `lib/coupons.js`, tables `coupons` /
`coupon_redemptions`, plus `orders.coupon_code` / `orders.discount`.

- **The affiliate lives ON the coupon.** An affiliate with no code has nothing to
  report on, and one with three codes is still one line in the report. The name
  is snapshotted onto `coupon_redemptions` rather than joined, so retiring or
  reassigning a code later never rewrites history. `commission_pct` is
  **reporting only** — nothing is paid out automatically.
- **The discount that reaches an order is always recomputed server-side.**
  `/api/coupon` prices the cart itself (never a subtotal from the browser) so the
  Apply button shows the same figure `/api/checkout` will apply — and checkout
  re-validates anyway. Same rule as `lib/pricing.js`.
- **A code that stops holding between Apply and Place order does not fail the
  sale.** Checkout drops it, charges full price, and returns `couponError` so the
  page can say so. Losing the order over a promo is the worse outcome.
- The discount comes off the **goods**, never the delivery fee (a third-party
  cost we pass through). HST is charged on what's left plus delivery.
- `exclude_clearance` narrows the eligible base to non-clearance units;
  `resolvePrices` now returns `onClearance` for exactly this.
- **The web invoice carries the discount as a negative `service` line**, so the
  paperwork totals what the customer pays. `createAndSendInvoice` /
  `updateInvoice` therefore accept a negative amount **on a service line only**
  (a negative unit line is a typo and would confuse the order bridge), and still
  require at least one positive line and a positive subtotal.
- **LANDMINE — one representation at a time.** The delivery fee is nowhere
  stored; every reader infers it as `total − subtotal − hst`, which a discount
  silently corrupts. So `orders.discount` is added back in wherever that
  inference is made (`updateOrderItems`, `OrderEditor`, the order page) — and
  when `updateInvoice` re-syncs an order it **zeroes `orders.discount`**, because
  the discount is by then a line item on the order and counting both would
  double it.
- Redemption is booked **inside the checkout transaction**, so a coupon can never
  be counted against an order that failed to be created. The 24h abandoned-
  checkout sweep calls `releaseCouponForOrder` — a checkout nobody finished must
  not burn a use of a limited-run code. An order a **human** cancels keeps its
  redemption (it was a real order) and simply reports no revenue.
- Deleting a coupon that has been redeemed **turns it off instead**, so nobody
  erases an affiliate's numbers by tidying up.

## Line kinds — discounts and trade-ins (added 2026-08-26)
A line was only ever `unit` or `service`, and every test in the codebase asked
"is it a service?" with unit as the else. Two more kinds broke that, so the
question is asked the other way round now: **`isUnitLine` (lib/constants.js) is
what decides whether a line carries a SKU, a warranty, a cost, and stock
movement.** `invoice_items.kind` and `order_items.kind` both hold:

| kind | sign | moves stock | on the van |
|---|---|---|---|
| `unit` | + | yes | delivered |
| `service` | + | no | — |
| `discount` | − | no | — |
| `trade_in` | − | no | **collected** |

- **Sign is enforced, never trusted.** A credit is TYPED as a plain positive
  number ("take fifty off") and STORED negative, so a subtotal is always just
  `SUM(amount)`. The flip happens at exactly two boundaries — `toPayload` /
  `fromInvoice` in `lib/invoice-lines.js` — which is what stops an edit negating
  the same line twice. `normalizeLines` in `lib/invoices.js` re-applies it
  server-side regardless of what arrived.
- A negative **unit** line is REJECTED with a message, never silently dropped:
  it's a typo, and deleting the appliance somebody just typed is worse.
- `components/InvoiceLines.jsx` is the one line editor, used by both
  `InvoiceForm` (new) and `InvoiceEditor` (edit). They were copy-pasted, which is
  how they drifted. The `5% / 10% / 15%` buttons snapshot a percentage **to
  dollars** on the spot — an invoice line is a figure, and re-deriving it later
  would move a total somebody has already quoted out loud.
- `order_items.kind` is what makes an order self-describing. Without it a
  trade-in and an appliance being delivered are both just a title and a price,
  and dispatch cannot tell them apart. NULL = unit (every pre-existing row).

**LANDMINE — refunding a line off a discounted invoice.** An invoice carrying a
credit charged LESS than its charged lines add up to, so refunding a line at face
value hands back money nobody paid. `refundInvoiceItems` therefore spreads the
credit across the charged lines (`creditFactorOf`): refunding a $1,000 unit off a
$1,000 sale that had $100 off returns **$900**, and the reclaimed $100 goes back
on the order as its own line so the order's items still sum to its subtotal.
Credit lines themselves are **not refundable** — you can't return a discount —
so they're excluded from the picker and from the "was that the last line?" test.

## Trade-ins — the unit that has to come back (added 2026-08-26)
We take the customer's old appliance in part-exchange and credit them for it. The
money is a `trade_in` line; the **logistics are the point** — a van that leaves
without it has left behind something we have already paid for.

- **Read live, never stamped.** `tradeInsForOrders` (lib/jobs.js) reads
  `order_items WHERE kind='trade_in'` on every board / run-sheet / driver load,
  exactly like `balancesForOrders` and for the same reason: a trade-in agreed on
  the phone at 11am has to be on the run sheet at 3pm.
- It shows on **five** surfaces, because each is the only one somebody looks at:
  the board card, the printed run sheet (boxed, so it survives a photocopy), the
  packing slip (both printed and emailed — the last paper read before the van
  loads), the driver's stop, and the driver's close-out.
- **The driver has to answer.** Close-out asks "Is their old unit on the van?"
  with no default. A `no` demands a reason and is written to `job_events` in
  capitals — a trade-in that was NOT picked up is what the office most needs to
  hear today, not next month off a stock count. `jobs.trade_in_collected` only
  ever moves forward, so a replayed close-out off the offline queue can't
  un-collect something already loaded.
- `importReadyBargainBayOrders` auto-tags the job `trade_in` and puts the unit in
  the job notes; **cargo excludes credit lines**, or the crew goes looking for a
  box called "Promo code SUMMER10".
- A job with no Bargain Bay order behind it (an external client) can carry the
  `trade_in` **service tag** by hand; every surface falls back to "see the notes"
  rather than showing nothing.

## Tax-inclusive pricing (added 2026-08-26)
The shop quotes both ways. "Twelve hundred out the door" is a tax-INCLUSIVE
figure, and the invoice still has to show it as $1,061.95 + $138.05 HST — an HST
registrant must state the tax separately. `lib/tax.js` does that split.

**The stored invoice is identical either way: line amounts are ALWAYS pre-tax.**
Tax-in is a way of *typing*, not a second way of storing money — nothing
downstream (the order bridge, refunds, dashboards, credit lines) knows or cares.
`invoices.tax_inclusive` records only how it was keyed, so reopening shows the
rep the figures they typed instead of $884.96 where they entered $1,000. It
changes no arithmetic.

- **The split is server-side.** `normalizeLines(items, { addHst, taxInclusive })`
  in `lib/invoices.js` converts, so create and edit can't drift and the browser's
  preview is never taken as read. The forms call the same helper only to preview.
- **The subtotal comes off the quoted TOTAL, not from dividing each line.**
  Dividing line by line and adding up drifts; the total is the number the
  customer was actually told, so that is the one that gets honoured. The rounding
  residue is then pushed onto the largest lines so the parts still add to the whole.
- **Roughly one cent-value in eight has no exact 13% split.** $100 tax-in is the
  standard example: $88.50 + $11.51 is a cent over, $88.49 + $11.50 a cent under.
  `exTaxOf` picks the closest and prefers to be UNDER rather than over, and the
  form says so out loud rather than letting a rep find an unexplainable penny in
  front of a customer.
- **Per-line cents are not recoverable, and that's fine.** [100, 100] tax-in and
  [100.01, 99.99] tax-in back out to the same pre-tax subtotal, so reopening may
  shuffle a cent between lines. The TOTAL is stable, re-saving an untouched
  invoice moves nothing, and the total is what was quoted out loud. Storing the
  typed figures as well would be a second representation of the same money —
  see the coupon landmine for how that ends.
- The mode is a **two-way** (`components/TaxMode.jsx`): before-tax or tax-in.
  Switching CONVERTS what's already in the boxes, so it reads the numbers rather
  than being a thing you must set first and remember. Credit lines convert too —
  a discount quoted tax-in is tax-in as well.
- **Nothing can be raised without HST any more.** Both invoice screens offer only
  the two modes, and the salvage screen's "Add 13% HST" checkbox — which
  defaulted to OFF, and is how zero-HST invoices got into the books at all — is
  gone; `/api/admin/salvage` now passes `addHst: true` unconditionally. Parts-only
  or not, it's a taxable supply.
- **`none` is nonetheless still a state an invoice can BE in**, because the
  historical ones are still in the database. Reopening one and hitting save must
  not silently add 13% to a settled sale, so the editor renders a third option
  *only* when the invoice it loaded already has zero HST; choosing a real mode
  retires it. Don't "tidy" that away — it's for records that already exist, not
  a choice anyone is offered.
- Sarah can raise a tax-in invoice (`taxInclusive` on `create_invoice`); a phone
  quote is exactly where "out the door" pricing gets used.

## Expense sorting, the ledger floor, and the P&L (added 2026-08-27)

### Where the books start
`getLedgerStart()` (`lib/finance.js`, setting `ledger_start`, default
`LEDGER_START_DEFAULT` = **2026-08-01**). **Both automatic feeds refuse anything
older**: QBO narrows its query to it, Plaid drops the transaction in
`mapTransaction`. The shop only started running on this system in August 2026 and
everything before that lives in whatever they used previously — importing it
gives a P&L stitched from two systems. Manual entry and uploaded purchase
invoices are deliberately **not** capped: those are a person recording something
on purpose.

### Sorting rules
`expense_rules` — a substring of a vendor name → a category, and optionally a tax
treatment. Both feeds run every incoming row through them, and
`applyRulesToExisting` sorts what's already in the ledger (a rule that only
helped future transactions would leave the pile that prompted it untouched).

- **Longest match wins**, so `canadian tire gas` beats `canadian tire`. Substring,
  not regex — these get typed by a shop owner between deliveries.
- **QBO's own account name beats a rule** when it has one: if the books already
  say Fuel, the books are more specific than a substring. A rule only fills in
  where QBO says nothing or "Uncategorised". For Plaid it's the reverse — a rule
  beats Plaid's guessed category, because the owner knows their own suppliers and
  Plaid has never heard of the wholesaler down the road.
- **The tax column is opt-in, and that is the point.** A rule saying "Esso carries
  13%" is the owner's judgement about a supplier they know. With no rule the row
  keeps `tax = NULL` and goes to the review queue. Never default it —
  auto-applying 13% is how invented input tax credits get onto a tax return.
- **Rule tax applies to Plaid only.** A bank line is gross, so `hst` splits it. A
  QBO line already carries its own tax figure from `TxnTaxDetail`, and overriding
  what the books say with a substring guess would be worse than the gap.
- `applyRulesToExisting` **only fills blanks** — a category set by hand, or a tax
  already answered, is never overwritten by a rule written afterwards.

### The P&L statement
`lib/pnl.js` → `/admin/reports/pnl`, printable, CSV at `/api/admin/pnl`.
Revenue → COGS → gross profit → operating expenses itemised by category → net
profit, with the previous comparable period beside it.

- **Same basis as the Sales dashboard** — its `SALE` predicate is deliberately a
  copy. A statement that disagreed with the revenue dashboard would be worse than
  no statement; if one changes, change both.
- **HST is excluded throughout.** Revenue is ex-HST because the tax is collected
  for the CRA, not earned; expenses are pre-tax because the recoverable part
  comes back as an input tax credit.
- **It states its own two failure modes** rather than leaving them to be
  discovered: cost coverage below 95% (gross profit is flattering by whatever the
  uncosted units cost) and any expense rows with no HST answered (counted at the
  full charge, so both expenses and the remittance are overstated).

## Bank feed (Plaid) + QuickBooks — where expenses come from (added 2026-08-27)
Two independent feeds into the same `expenses` ledger, both dormant until their
env vars are set, both idempotent via `expenses.ext_id`.

- **Plaid** (`lib/plaid.js`) is the bank. `/transactions/sync` is a CURSOR
  endpoint — the cursor is persisted **after every page**, because a first pull
  of two years across several accounts will hit the function time limit and a
  cursor written only at the end would restart from scratch every night and
  never catch up.
- **The webhook is what makes it live** (`/api/plaid/webhook`). It carries no
  data we trust — it only triggers a pull with our own credentials — so the
  guard is "is this one of our items" plus a 60s throttle, not signature
  verification. Full JWT verification would be reasonable hardening; it is not
  what stands between this and bad data.
- **The nightly pull is folded into `/api/cron/sync-inventory`**, beside the QBO
  sync, rather than getting its own `vercel.json` entry — the plan's cron
  allowance is small and these are one finance pass.
  `/api/cron/sync-bank` exists for triggering it by hand.
- **What is deliberately NOT imported:** pending rows (they're replaced when they
  post), money IN, and `TRANSFER_IN`/`TRANSFER_OUT`/`LOAN_PAYMENTS`/`INCOME`. A
  credit-card payment is the same money as the purchases it settles — importing
  both counts every charge twice. A `BANK_FEES` row IS a cost and is kept.
- **An imported amount is GROSS and its tax is NULL.** The bank never saw the
  receipt. Guessing 13% on import would invent input tax credits on wages,
  insurance and US purchases. `listUnreviewedExpenses` + the "HST to confirm"
  panel is where a person answers them, in batches — one at a time is how
  thousands of rows never get answered at all.
- **LANDMINE — two splits, two rules.** `splitGross` (lib/tax.js) divides a known
  charge so the halves add back to it exactly; `exTaxOf` finds a subtotal that
  reconstructs a QUOTED total and may land a cent off. Expenses use the first,
  invoices the second. `bulkSetExpenseTax` does `splitGross`'s arithmetic in SQL
  so several thousand rows are one statement — keep it in step with the helper
  or the review screen previews a figure it will not produce.
- **QuickBooks** (`lib/qbo.js`) was already complete; it only ever needed
  `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET`. If BOTH feeds are connected to the same
  bank account the same spend arrives twice under two different `ext_id`s —
  pick one per account.
- **LANDMINE — sandbox keys import a DEMO company's spending as if it were real.**
  Found live on 2026-08-27: the production site had been connected to Intuit's
  "Sandbox Company US 93dd" for 48 days, and 46 rows of a fictional landscaping
  firm's car washes and burger receipts were sitting in the expense ledger,
  marked "edit in QB" so the table offered no way to remove them. The panel said
  `CONNECTED` in green and nothing else. `qboStatus` now returns `env` and
  `sandboxCompany` (Intuit's demo companies are all named "Sandbox Company …",
  so the name is checked as well as the env var — the var can be changed without
  the stored tokens being redone), the panel says so in red, and the
  already-existing `purge_synced` action finally has a button. Sandbox and
  production keys are DIFFERENT keys: switching worlds means replacing both
  secrets, not just flipping `QBO_ENV`.

## HST remittance — the Sales dashboard panel (added 2026-08-27)
`hstOwed()` in `lib/analytics.js`, rendered by `components/TaxOwed.jsx` on
`/admin/dashboard` directly under the revenue KPIs. Owner-only (`!salesOnly`),
same reasoning as the Profit KPI beside it.

- **Basis: the sale date.** Every figure is dated to `orders.created_at` — the
  invoice date for an invoice-raised sale — because HST is charged when the sale
  is made, not when the money lands. That is what an accrual filer reports, and
  it is the same basis as the Revenue KPI, so the two agree on screen.
- **The collected / still-to-come split is deliberate.** The liability and the
  cash position are different questions: on a deposit sale the tax is owed from
  the day the invoice was written, while most of the money arrives on delivery.
  The "collected, not yet remitted" card is the one that stops a good year
  becoming a bad quarter.
- **Refunds need no line.** A refund shrinks its order's `hst` in place, in the
  month of the original sale, so every total is already net of anything handed
  back. Don't add a "refunded" figure — it would double-count.
- **Quarters are calendar quarters** (most small registrants file quarterly), and
  a quarter with no sales still prints as zeros so a gap reads as a quiet quarter
  rather than as missing data. The quarter in progress is flagged; a part-period
  total read as a finished one is how a remittance comes up short.
- **LANDMINE — one live invoice per order.** The uncollected-HST expression takes
  the NEWEST live invoice (`ORDER BY i.id DESC LIMIT 1`), not a SUM over them —
  same guard as `balancesForOrders` in `lib/jobs.js`. Summing would report the
  same tax as uncollected twice. (`revenueDashboard`'s own `owing` still JOINs;
  if that is ever corrected, correct it the same way.)
### Input tax credits — the other half
`hstRemittance` nets **credits** off what was charged. They come from three
places, all dated to the document (accrual, same basis as the sales side):

- **Stock invoices** (`purchase_invoices.tax`) — the biggest one for this
  business. Captured when a supplier invoice is uploaded at intake: the extractor
  now reads the invoice's own subtotal/tax/total footer as well as the line
  items, and the review screen makes the owner CONFIRM the tax before it's
  claimed. A model reading a scan is not something to file on trust, so the
  screen also flags a total that doesn't add up or a tax that isn't ~13%.
- **Operating expenses** (`expenses.tax`) — entered by hand or synced. The form
  takes either the pre-tax cost or the receipt total and splits it (`lib/tax.js`,
  the same helper the invoice screens use).
- **Ad spend** (`ad_spend.tax`).

Rules that must hold:
- **`amount` stays PRE-TAX.** The P&L is built on it, and folding the recoverable
  tax into a cost would overstate every expense. `tax` is a separate column.
- **NULL is not zero.** A NULL `tax` means nobody has looked at that row yet.
  `coverage` reports how much of the year's recorded spending is still NULL, and
  when it's under 80% (or there are no credits at all) the panel relabels the
  total "at most" and says why. A remittance that silently treats unreviewed
  spending as tax-free overstates what's owed, and nothing would say so.
- **A stock purchase is NOT an expense row.** Unit cost already reaches the P&L
  per-unit through the tracker; putting the purchase in `expenses` too would
  double-count every appliance. `purchase_invoices` exists for the tax alone.
- **Re-uploading a supplier invoice UPDATES it** (unique on vendor + invoice
  number). Claiming the same credit twice is the way this feature could cost real
  money. An invoice with no number can't be de-duped and always inserts — a
  visible duplicate beats a silently merged pair.
- The QBO sync **no longer discards the tax**. It pro-rates `TxnTaxDetail.TotalTax`
  onto the share of lines that survive `EXCLUDE_ACCOUNT`, and a hand-corrected
  figure is never blanked by a later sync (`COALESCE(EXCLUDED.tax, expenses.tax)`).

**Still not captured:** anything that never becomes a record — cash spends, bank
and e-transfer activity nobody enters. That is the gap `coverage` is there to
make visible.



## Dispatch — deliveries & service calls (added 2026-08-25)
The daily run sheet used to be built by hand because the work comes from several
client companies through several channels (email, spreadsheet, phone) and no one
system holds it all. `/admin/dispatch` is the board; `/admin/dispatch/print` is
the paper run sheet that replaces it.

- **A job is NOT an order.** Orders carry money, tax, inventory and revenue
  meaning; a service call run for another company carries none of it, and putting
  it in `orders` would pollute every revenue query. A Bargain Bay delivery is a
  job that links back via `jobs.order_id`. See `lib/jobs.js`, tables `jobs` /
  `job_items` / `job_events` / `clients`.
- **Delivery windows are promised to customers and set per job by the team —
  they can start at ANY hour.** So an arbitrary `window_start` / `window_end` is
  the real input; `WINDOW_PRESETS` are only one-tap shortcuts. Routing (phase 3)
  therefore sorts by `window_start` and may only reorder stops whose windows
  OVERLAP — a route can never be resequenced across a promise, which is what
  keeps the cheap Directions API sufficient instead of the fleet solver.
- **A service call is raised against one of OUR sales or an external client.**
  The form asks which first: "Something we sold" searches past buyers (name /
  email / phone / BB- number), then lists their orders — picking one fills the
  address, names the unit, and stores `service_tickets.order_id` so a warranty
  call always points back at the sale. "External client" skips all of it and is
  typed by hand. Lookups: `findServiceCustomers` / `ordersForServiceCall`.
- **A service ticket is the customer's PROBLEM; a job is one visit against it**
  (`service_tickets`, `jobs.ticket_id`). They're separate because a repair
  routinely takes several trips, and "how many open service calls?" has to count
  problems or every revisit inflates the number. `completeServiceVisit` records
  time in/out, outcome, parts used/needed and who signed, and the OUTCOME is what
  moves the ticket (`OUTCOME_TO_TICKET`): fixed/no-fault resolve it, parts_needed
  parks it on `awaiting_parts`, not_fixed/pending leave it open.
- `shipment_type` is **white_glove | threshold** — how far into the property the
  crew goes (into the room and unpacked, vs the door and no further). The driver
  has to know before getting out of the van, so it's shown on the board card and
  in bold on the run sheet.
- `jobs.services` is a **text[] of tags** (`JOB_SERVICES`: delivery_only, install,
  haul_away, exchange, return_pickup, parts_drop, warranty) — one visit is
  routinely several at once. Tags rather than free text so they stay countable;
  anything unusual goes in `notes`. Unknown tags are dropped on write.
- **Lat/lng is captured from the address autocomplete at entry time**, so routing
  never pays to geocode the same address twice. Keep that in any new job form.
- **A failed stop is a real outcome** with a reason code (`FAIL_REASONS`), not an
  absence of a completion. `setJobStatus` refuses `failed` without one.
- Bargain Bay orders enter by **pull, not push** (`importReadyBargainBayOrders`,
  the "Pull Bargain Bay orders" button). Deliberate: nothing new hangs off the
  order-status path the storefront depends on, and the dispatcher controls the
  day. Idempotent — an order that already has a job is skipped.
  **Eligible = `confirmed` | `ready` | `out_for_delivery`** (`IMPORTABLE_ORDER_STATUSES`)
  with `delivery_method = 'delivery'`, an address, and no job already against the
  order. `out_for_delivery` is in that list because it is what the owner reaches
  for when an order is loaded and going out today; without it the pull silently
  did nothing (BB-1179). A job that was **cancelled** still blocks the automatic
  re-import — cancelling is how a stop comes OFF the board, and a pull that undid
  that every morning would be worse.
  **The pull reports what it declined and why** (`skipped[]`), because a button
  that can no-op in silence is how an order ends up delivered from memory, and
  every reason except a missing address carries **"Add anyway"**
  (`importOneBargainBayOrder`, POST `action: 'import_order'`) so the dispatcher
  is never sent off to edit an order to fix a board they're looking at.
- **Every card says whose job it is and which order.** `dispatchBoard` joins
  `orders` for `order_number`; the card and the run sheet print
  `RS-1021 · BB-1179 · Bargain Bay` (or the client's name). The driver is asked
  about "the BB-1179 fridge" on the phone, never about RS-1021.
- **Any order can be put on the board by number** (the `BB-1078` box next to the
  pull button). The pull only scans the recent weeks; a special order sold in
  June still gets delivered in August. If the order has no address — every
  **pickup** order has none — it asks for one and puts it on the JOB, not back
  onto the order: the customer still bought it as a pickup, we're just driving it.
- **The driver's sign-in link takes TWO steps on purpose.** `GET /d/<token>`
  only ASKS ("Sign in on this phone"); the button POSTs and that is what spends
  the token. A GET used to redeem it, so the preview card iMessage/WhatsApp
  builds by fetching the URL was burning the link before the driver's thumb got
  there — the session went to a crawler and the driver saw "already used".
  Crawlers don't POST. `peekDriverSignInLink` reads the link without spending it;
  the POST redirect is **303** (a 307 replays the POST at /driver → 405).
- **A driver's session belongs to the host the link opened** (`dispatch.rssolutions.ca`)
  — the cookie is host-only and bargainbay.ca can never see it. `/driver` says so
  when signed out rather than implying the driver isn't set up.
- **Photos can be added AFTER close-out.** `POST /api/driver/jobs` with
  `mode=photos` stores pictures and nothing else — no completion, no signature,
  no delivered email (re-saying it would email the customer twice). Batches
  dedupe on `job_photos.ref` (NOT unique — one batch is several rows), checked
  before anything is written. The pictures are the part of a stop a driver
  remembers after walking away from it.
- **Never put `capture` on a photo input.** On iOS it makes the input
  camera-ONLY — no library, and `multiple` ignored — so a driver who shot the
  delivery with the normal Camera app cannot attach it. Offer two buttons.
  Decoding goes through `components/photo-pick.js`: `createImageBitmap` first,
  an `<img>` fallback (iPhone HEIC), then the original file if the shrink fails,
  and failures are COUNTED and shown, never swallowed.
- **The balance is collected from the job card.** PATCH `action: 'record_payment'`
  → `jobInvoiceForPayment` → `recordInvoicePayment` on the ORDER'S invoice, so
  there is one money ledger and not a dispatch copy of one; the job gets a
  `job_events` line. Staff-level, matching the Invoices page — the person who
  takes the cash has to be the one who can log it, or it gets logged tomorrow
  from a note in a pocket. Paying off the balance settles the invoice through
  the normal `markInvoicePaid` path (receipt, order → `confirmed`).
- **What's still owed prints on the stop.** `balancesForOrders` reads the live
  invoice ledger (`total − payments` on an `open`/`partial` invoice) and the board,
  the run sheet and `/driver` all show "Collect $X". Read live on every load,
  never stamped on the job: the shop's flow is deposit now / balance on delivery,
  so a payment taken at 11am has to change what the driver is told at 3pm.
- **The board pages sideways and each column scrolls itself** (`BoardColumn`,
  `.disp-page` / `.disp-scroll`). Columns are a fixed width so one page is one
  column, and the arrows are rendered only when there is something off-screen —
  this runs on a warehouse touchscreen with no trackpad, where a scroll area
  nobody can see the edge of is a driver's whole day nobody knows exists. Both
  are off under 700px, where the columns stack.
- **Any job can be corrected after the fact** (`updateJob`, PATCH `action: 'edit'`)
  — name, phone, email, address, the transfer's pickup end, what's on it, window,
  day, shipment type, services, notes. The **same `JobForm`** does it, prefilled:
  a second form would drift from the first. Only what's PASSED is written, so a
  caller that doesn't know a field can never blank it; a changed address clears
  the old lat/lng with it (stale coordinates route the driver to where the
  customer used to live); `appliance`/`issue` are written to the TICKET, not the
  visit, or the next revisit still carries the wrong fault. Money and `type` are
  NOT editable here — charge goes through `setJobCharge` (which refuses to move
  an invoiced one) and changing a delivery into a service call would orphan its
  ticket. Editing a BB-linked job says so: it changes the STOP, not the order.
- **`assignJob` only writes `seq` when it is GIVEN.** It used to set it
  unconditionally, so every other thing that function does — changing the driver,
  pairing a second one, moving the day — silently wiped the stop's place in the
  run. That was harmless while nothing was ordered and became a quiet reshuffle
  of somebody's route the day the board started numbering. The one case that DOES
  clear it is a stop changing hands: a position only means something inside one
  person's run, and carrying "4" into another driver's column drops it into the
  middle of a route it was never part of.
- **The run is ordered from the card** — a numbered seat plus ▲▼ on every stop a
  driver OWNS, calling `resequence` with that whole run in its new order
  (renumbering only the card that moved would leave two stops claiming one
  place). Numbered because "third stop" is how a dispatcher and a driver talk on
  the phone; arrows and not drag for the same reason assignment is a tap — this
  is used one-handed on a warehouse touchscreen.
  **`resequence` writes `seq` and NOTHING else.** It used to write `driver_id`
  and `job_date` on every id it was handed, which turned a reorder into a
  reassignment — and a driver's column also shows the stops they are riding on as
  somebody's SECOND man, so nudging one card up in Ruban's column quietly made
  Ruban the primary driver of every paired stop in it, and those stops vanished
  out of the column of the driver actually running them. A stop the caller
  doesn't own is skipped, not stolen. The board mirrors that split: `byDriver`
  (what the column shows, either seat) is now separate from `ownedBy` (the run —
  what numbers, reorders and counts), and a column carrying both says so
  ("3 own stops · riding on 2 of someone else's").
- **A stop can carry TWO drivers** (`jobs.driver2_id`). Two people sent together
  are ONE van doing ONE run, so it is a second NAME on the job, not a second copy
  of it — the running order, the money, the POD and the completion all stay
  single, and there is no way to half-finish a stop from two phones. Both see it
  (`driverJobs` matches either seat), and `jobBelongsToDriver` lets both through —
  a second driver who can see a stop but not sign it is worse than one who can't
  see it. The board lists the card in BOTH columns, but only the primary's column
  owns the ▲▼ (`seat` is null in the other), and the second reads "Riding with
  <name>". `assignJob` refuses to seat the same person twice or to fill the
  second seat with the first empty. **Pay is still one `pay_amount` on the job** —
  who splits it is a decision nobody has made yet.
- **Nothing on the board is a dead end.** A closed stop (done / failed /
  cancelled) can be **Reopened** (`reopenJob`, PATCH `action: 'reopen'`) — a
  customer rings back, a driver taps Done on the wrong card, a cancelled
  delivery is rebooked for Thursday. `assignJob` still refuses to move a closed
  job, and now names the button that fixes it. Reopening KEEPS the signature, the
  photos and the money: it says the work isn't finished, not that it never
  happened. It DOES clear `time_in`/`time_out` (writing what they were into
  `job_events` first) — those are stamped once and only once now, so leaving them
  behind would mean a stop reopened at 2pm and genuinely finished at 4pm still
  reported 2pm, and that number is what the profit report bills an hour against.
- **Cancelled stops stay on the board**, in their own greyed column, because a
  card that vanishes is indistinguishable from a deleted one — and a cancelled
  BB job still blocks its order from being pulled in again. `dispatchBoard`
  returns them as `cancelled[]`; don't filter them back out of the query.
- **The card can move a stop to another day** (the Day picker → `assignJob`'s
  `jobDate`). Before that the only route was cancel-and-retype, which is absurd
  for the most ordinary thing that happens to a delivery.
- **Every date or time rendered on the SERVER must name its zone.** Vercel runs
  as UTC and the business runs on Toronto time, so `toLocaleTimeString` with no
  `timeZone` emailed the office **8:02 pm** for a stop the driver finished at
  **4:02** — and would print TOMORROW's date on a POD for anything closed after
  8pm, on a form a customer had signed. `torontoTime` / `torontoDate` in
  `lib/constants.js` are the only way these should be formatted server-side. The
  driver app and the board format in the BROWSER, which is already on Toronto
  time, which is exactly why the discrepancy showed up as the app and the email
  disagreeing rather than as one obviously wrong clock.
- **Dispatch mail goes to the RS inbox** (`DISPATCH_INBOX()` = `DISPATCH_EMAIL`
  env, else `SERVICE_EMAIL` = Service@rssolutions.ca). Left to `sendEmail`'s
  default it falls back to `NOTIFY_EMAIL`, a **Bargain Bay gmail** — the people
  running the runs would never see it.
- **A failed stop emails the office immediately** (`emailJobFailed`, off
  `setJobStatus`). It is the one thing that has to be acted on TODAY — rebooked,
  customer rung, someone sent back — and waiting for whoever next opens the board
  to notice is how it becomes tomorrow's angry phone call. Office only: a client
  hears about a failure from a person, not an automated apology.
- **Somebody is told when a stop finishes.** `emailJobComplete` mails the office
  every completion and the CLIENT when `clients.notify_on_complete` is set —
  that column was collected in the form, stored, and read by nothing, so a client
  company found out by asking. Best-effort and after the write: a mail hiccup
  must never fail a completion a driver is standing in a doorway waiting on.
- **The run sheet is ONE PAGE PER RUN, not per driver.** Two drivers sent
  together are one van doing one route, and it used to print that route TWICE —
  once under each name, identical, because it grouped by driver and a driver's
  list included the stops they were only riding on. Two sheets for one van is two
  sheets to keep in step, and nothing on either said they were the same run. The
  page belongs to whoever OWNS the stops (the primary holds the running order),
  the header carries both names ("RUBAN + ARDY"), and a driver who is only ever a
  second seat gets no page of their own. Same `byDriver` / `ownedBy` split the
  board draws — see the resequence landmine above.
  When the whole run shares one second driver, the name goes in the HEADER and
  comes off every row, where it printed seven times over and read as noise; a
  mixed day still notes "with X" per stop. The Collect column only renders when
  the run actually has money to bring back (it was a column of "—"), phone
  numbers print as `(437) 488-8549` rather than `4374888549`, "Own job" no longer
  prints as a label for the absence of a client, and every stop carries **In /
  Out** rules — the office costs a delivery by the time it took, so the times
  have to survive a dead phone and get typed in off the sheet.
- **Anything meant to be printed carries a Print button** (`components/PrintButton.jsx`
  → `window.print()`): the run sheet and the POD form. "Press ⌘P" is not a
  feature, and on the warehouse tablet there is no ⌘P at all — Save as PDF is a
  destination in that same dialog, so one button covers both. Each page's
  `generateMetadata` puts the date / order number in the title, because the
  browser names the saved PDF after `document.title` — "Run sheet 2026-08-26.pdf"
  in a folder of thirty beats "Run sheet.pdf". Their print CSS also unwinds the
  portal's `.wrap` (its max-width would print as a narrow column) and keeps a
  stop from splitting across two pages.
- **The signed POD form is the paper form.** `jobs.pod_form` (jsonb) holds the
  two damage answers, the explanation, the per-item table and the printed name;
  `/admin/dispatch/pod/<id>` renders it for printing or emailing to a client.
  One jsonb because it is a FORM — read back whole, printed whole, its shape
  following the paper it replaces rather than a query. `normalizePodForm`
  sanitises on the way in (a phone running an old build can never widen it), and
  the write is `COALESCE($8, pod_form)` so a replayed completion off the offline
  queue can't blank a form somebody already signed. The consent paragraph names
  the CLIENT company when the job has one — on a shared form the indemnified
  party has to follow the job.
- **Item lines are prefilled from the job**, ticked by default, untickable. A
  driver retyping a model number on a doorstep is how "Whirlpool WRFF3536SW"
  becomes "whirpool fridge".
- **Driver pay is single-sourced by an EXPLICIT dispatch amount.** `payroll.js`
  pays a flat rate per delivered BB order; dispatch pays `jobs.pay_amount` per
  stop. Payroll now skips an order whose job carries a `pay_amount` — and ONLY
  then. An unpriced job still earns the flat rate, because silently leaving a
  driver unpaid is a far worse failure than counting a delivery twice. The
  payroll table shows what it carried ("+2 paid on dispatch") so a short count
  is never a mystery.
- **Proof of delivery is downloadable**, not just viewable:
  `/api/admin/pod?...&download=1&name=<label>` sets Content-Disposition, the card
  has a ⤓ per item and a "save all", and the filename is the job + order, never a
  blob id. It has to be able to leave the building for a damage claim.
- **Places autocomplete is per INPUT, not per form** (`attachAutocomplete(e, which)`).
  The pickup end of a transfer is a real address somebody has to find; it was
  being typed by hand while the drop-off got autocomplete.
- **A client's sheet becomes stops on the Import tab** (`lib/stop-import.js` +
  `components/StopImport.jsx`, POST `action: 'import_stops'`). **Paste is the
  primary input, not upload** — what people do is select the rows in the Excel
  the client emailed and hit copy, and Excel's clipboard is a TAB-separated
  table. That one input therefore covers the attachment AND the stops typed into
  an email body, with nothing to save first. **`.xlsx` is read directly** —
  `lib/xlsx-lite.js` opens the workbook with nothing but Node's own zlib (an xlsx
  is a ZIP of XML: the sheet is `xl/worksheets/sheet1.xml` and its text lives
  once in `xl/sharedStrings.xml`), so there is no SheetJS to keep patched. It
  goes through `POST /api/admin/dispatch/sheet`, which only READS — a
  spreadsheet that creates stops by being uploaded is a spreadsheet nobody
  checked. Multi-tab workbooks get a sheet picker; `.xls` is a different format
  and says so.
  The parser lives in `lib/stop-import.js` and knows NOTHING about the page —
  the future email inbox hands it the same rows. It sniffs the delimiter, handles
  quoted commas (addresses are full of them), decides whether row 1 is a header,
  guesses the mapping from ~90 header aliases, and normalises dates (incl. Excel
  serials) and times. **Nothing is written until every row has been previewed**
  with its problems named; a missing address blocks that row and only that row.
  Three things a real client sheet taught it: **Excel error literals**
  (`#VALUE!`, `#N/A`) are blanked, or they print on a run sheet a driver reads in
  a van; the mapping walks the **FIELDS** and takes the strongest alias, because
  header order used to decide it and a sheet carrying both `Model` and `Product
  Description` put the SKU in the item line and threw the description away; and a
  pickup column must contain a **street number** — freight sheets put a HUB name
  ("Kitchener") in `Origin`, and reading that as an address turns every stop into
  a transfer to nowhere, so it goes to the notes instead.
  **Item cells split on `;` and `|` but NEVER on commas** — "One pallet -
  radiator, 175 lbs" is one thing, and splitting it puts a phantom line on a POD
  the customer signs.
- **A PDF run sheet or BOL is READ, not parsed** (`lib/pdf-stops.js`, same route).
  A spreadsheet is a table; a bill of lading is a LAYOUT — boxes, per-page
  headers, consignee in one corner and shipper in another — and a parser guessing
  at one produces wrong addresses silently, which is worse than reading none. So
  it goes to Claude as a `document` block exactly as `lib/purchase-intake.js`
  already does for supplier invoices, and comes back as **the same table shape**
  the spreadsheet importer produces (`PDF_COLUMNS` is literally a header row the
  mapper knows), so preview, problems and confirm are one code path. Photos of a
  paper sheet work too — same block, `image` instead of `document`.
  The prompt's hard rules are the ones that matter: **never invent an address, a
  postal code or a phone number** (a missing field is fine, a wrong one sends a
  van to the wrong door); the delivery address is the CONSIGNEE's, never the
  shipper's or the carrier's own; a depot NAME with no street number is not a
  pickup address; and items join with `;` because a comma inside one item makes
  it look like two. A reply cut off at `max_tokens` is repaired back to the last
  complete row and flagged, rather than failing the upload. The rows carry a
  visible **"read by AI — check every row"** banner in the preview; the model
  proposes and a dispatcher still confirms.
- **A BOL bound for Quebec is OUR PICKUP, not a drive to Montreal.** The owner's
  standing arrangement: those loads are collected from the shipper and dropped at
  the cross-dock (`QUEBEC_DROP`, default 1213 International Boulevard, Burlington
  — the address already on the board for every one of them, overridable by env).
  So `toJobs` rewrites the stop: destination becomes the drop, the SHIPPER block
  becomes the pickup (with its contact and phone), and the real consignee is kept
  in the notes because that is what the paperwork and the phone call both refer
  to. `isQuebecBound` trusts the province column when it has one and falls back
  to city names, since plenty of BOLs leave province blank. It is a **checkbox,
  on by default**, and the redirect is stated in the row's problems — a stop
  quietly redirected to another city is exactly the kind of thing that should
  never happen invisibly. A QC row with no pickup address is BLOCKED: a
  cross-dock drop with nowhere to collect from is not a job.
- **Everything dispatch does happens on `/admin/dispatch`.** Board, service-call
  queue, and clients/drivers are TABS on that one page, not separate screens, and
  a client can be added from inside the new-job form itself. Do not move any of
  it to another route: sending someone elsewhere to add a client mid-call is the
  friction that sends a dispatcher back to paper.
  `/admin/dispatch/tickets` is only a redirect kept so older links resolve.
- **Both sides of the money live on the job.** `pay_amount` is what it costs us
  (what the driver/tech is owed); `charge_amount` is what the CLIENT pays us.
  Margin per run is therefore visible while it's fresh. Both admin-only.
  **Both are set from the STOP's own card** (`MoneyForm`, "Set charge"), on any
  job, at any status, client company or not. They were previously reachable only
  from places that excluded exactly the jobs that needed them: a charge only from
  the Billing tab, which lists **finished** jobs belonging to a **client**, so an
  imported Bargain Bay delivery (no client, not yet delivered) had no reachable
  charge at all; and pay only from inside the close-out form, so a stop already
  done could not be priced. The card still calls `setJobCharge`/`setJobPay`, so
  the invoice guard and the admin gate are unchanged, and it sends only the half
  that actually moved — re-posting an unchanged charge on an invoiced job would
  be refused over a number nobody touched.
  **The edit form's charge box used to write nowhere.** `JobForm` renders it,
  prefills it and sends it on every save; `updateJob` had no column for it and
  silently dropped it. It now hands off to `setJobCharge` (not a second write
  path — the invoice rule has to hold), and only when the value changed. Because
  `action: 'edit'` is STAFF-level while a charge is admin-only, the route strips
  `chargeAmount` from the patch for a non-admin: routing money through a staff
  action would quietly widen the gate.
- **Weekly client invoicing.** The Billing tab lists finished, not-yet-billed jobs
  per client for a period; one button raises a real invoice through
  `createAndSendInvoice` (a line per job, unsent, lands in Invoices and books
  revenue on its date like any other). `jobs.invoice_id` is stamped only AFTER
  the invoice saves, and `setJobCharge` refuses to move a charge once it's set —
  a job can never appear on two invoices. Needs `clients.contact_email`.
- **A job can be a transfer** — `pickup_address` / `pickup_city` /
  `pickup_postal` set means it runs FROM there TO `address`, and it carries its
  own **company AND contact**: `pickup_company` / `pickup_name` / `pickup_phone`.
  Both, because they are different things and a BOL names both — "Avron School
  and Daycare Supplies" is written on the building the driver is looking for,
  "AMRITA NADAR" is who to ask for inside. The drop end has had this split all
  along (`customer_name` + `phone`); the pickup end was carrying a person in the
  field that should hold a business. **Both ends of a transfer are
  somewhere a driver has to be let into**, so both need somebody to ring — a
  locked door with no number on the sheet is how a transfer becomes a wasted
  morning. Shown on the board card, the run sheet and the driver's stop, and the
  driver gets a second Call button (the two are labelled "Call pickup" and
  "Call drop-off" only when there are two, so an ordinary delivery still just
  says Call). Shown as "A → B" on
  the board and as FROM/TO on the run sheet; the driver needs both ends.
- **Times and pay.** Closing out ANY job (not just a service call) records
  `time_in` / `time_out` — time actually on site — plus who signed. `pay_amount`
  is what the person who did that job is owed, set per job at close-out and
  **admin-only**. The Pay tab rolls it up per person for today / this week / this
  month, counting COMPLETED jobs only, and reports how many are still unpriced so
  a short total is never mistaken for a finished one.
  **This is separate from `lib/payroll.js`**, which pays shop work by piece rate
  and drivers a flat rate per Bargain Bay *order* delivered. Using both for the
  same delivery counts it twice — external clients' work only exists here, so
  there's no overlap on that side.
- **Revisits.** `bookRevisit(ticketId)` — the "+ Revisit" button on a ticket row —
  copies the customer, address and appliance onto a new visit against the SAME
  ticket and drops it in "To assign". Without it a second trip opens a second
  ticket and the open-service-call count inflates.
- **Gate exception:** dispatch uses `isStaff`, making it a FOURTH staff surface
  beyond the three named in the gate rule below. Intentional — whoever answers
  the phone has to be able to put the job on the board. Adding a **client** is
  staff too (it's a company name). Adding a **driver** stays `isAdmin` — that one
  is a real access grant.

## The driver app (phase 2, added 2026-08-25)
`/driver` is the driver's whole world: today's stops, and the three things they
do to one. It replaced the order-based screen — that one could only ever show
Bargain Bay deliveries, so a service call for another company was invisible to
the person doing it. **It is jobs now** (`lib/driver-jobs.js`), and the old
order-based `/api/driver/{deliveries,start,pod}` + `DriverDeliveries` /
`PodCapture` are deleted.

- **Sign-in is a text message.** The office adds a driver by NAME + MOBILE
  (`addDriverByPhone`); they get an SMS, tap it once, and that phone is signed in
  for 180 days. No signup, no password — that friction is what kept drivers on
  paper. The account is still a `users` row (so `jobs.driver_id`, the board's
  columns and the pay report are unchanged), with a synthetic
  `driver-<digits>@drivers.bargainbay.ca` email and a deliberately unusable
  password hash: there is nothing to phish, and the account is on no staff list,
  so a driver's phone can only ever reach driver surfaces.
- **The everyday door is a phone number and six digits** (`startDriverCode` /
  `verifyDriverCode`, `POST /api/driver/signin`, the form on a signed-out
  `/driver`). The driver types the mobile the office already has for them, we
  text a code, they type it, and that phone is signed in for 180 days. The link
  is for DAY ONE only: it is one message that gets deleted, tapped on the wrong
  phone, or lost with the device, and then somebody is standing at a van waiting
  for the office to open. Both steps answer identically for an unknown number —
  a form that says "no such driver" tells anyone who drives here. Code lives 15
  minutes, dies after 5 wrong guesses, 5 sends per driver per hour, hashed at
  rest, and a new one retires the old.
- `driver_links` stores the **hash** of the token, 14 days, and is **REUSABLE**
  inside that window. It was single-use, which drivers reported as "the link
  expires every fifteen minutes" — they reopen the app the only way they
  remember, the text, and the second tap said expired. Minting a new link no
  longer kills the old ones either: killing them silently broke the text a driver
  still had. `used_at` records the first tap for the roster and never blocks a
  later one. The link is ALWAYS shown to the office too — a failed Twilio send
  must never leave a driver unable to start.
- **`/d/<token>` must stay in `proxy.js`'s allow-list.** The link is texted on
  the RS host; without it every driver is bounced to a board they can't see.
- **Tomorrow is visible today**, in its own collapsed list under the day's work
  (`driverJobs` returns `tomorrow[]`). Drivers asked for it: you plan the night
  before — what's loaded, which end of the region you start at, whether the 8am
  is white glove. It is a SEPARATE array rather than more rows in `stops`, and
  its cards carry Navigate/Call and nothing else, so nothing on the phone can
  start, finish or fail a stop that isn't today's.
- **Nothing waits on the network.** Every tap is written to IndexedDB
  (`lib/driver-outbox.js`) and sent afterwards — basements and rural stops lose
  signal, and a completion that fails and loses the signature sends drivers back
  to paper. Photos and the signature are BLOBS in the queue, which is why it's
  IndexedDB and not localStorage. The queue drains on load, on `online`, and on a
  30s timer (a van drives in and out of signal without firing an event).
- **Replays must be free.** Each queued item carries a `ref`; `jobs.pod_ref` is
  the completion already recorded, so a second upload is answered, not written.
  Status changes are idempotent server-side (a replayed "arrived" on a finished
  stop returns ok). Refreshing the list is SKIPPED while anything is queued —
  the queue is the truth until it drains, or the server's older answer would
  wipe the driver's screen.
- **A finished BB delivery marks its ORDER delivered** (`markOrderDeliveredForJob`)
  — customer email, delivered_at, units sold — exactly as the old screen did.
  A deposit sale still in `pending_payment` IS moved: the goods physically left,
  and `markInvoicePaid` only promotes `pending_payment`/`confirmed`, so settling
  the balance later can't drag it backwards.
- **The balance is collected in the app**: the close-out screen prefills what's
  owed, and the payment is queued FIRST — if the phone gets one thing out before
  the signal dies again, it should be the money.
- **Assigning from Operations reaches the board too** (`assignDelivery` creates
  and assigns the job). Two assignment screens that don't agree is how a driver
  ends up with a stop nobody told them about.
- Proof of delivery lives on the job (`jobs.signature_path`, `job_photos`) and is
  readable by the office through `/api/admin/pod?jobsig=`/`?jobphoto=`, shown on
  the board card. Proof nobody can look at is not proof.
- PWA: `public/driver.webmanifest` + `public/driver-sw.js` (shell only —
  network-first for the page, never caches `/api`). Installed via **Add to Home
  Screen**; there is no app store and no native build.
- **Never hard-code "Share → Add to Home Screen".** That is the iPhone-Safari
  answer to a question four phones answer four ways, and a driver who cannot find
  the button we named concludes the app is broken (it happened). `AddToHome.jsx`
  asks the phone: Android Chrome gets a real **Install** button off
  `beforeinstallprompt` (⋮ → Add to Home screen as the fallback), iPhone Safari
  gets the Share icon plus "no bar at the bottom? tap the bottom edge" (it hides
  on scroll), an in-app browser (WhatsApp/Facebook/Instagram, or Chrome/Firefox
  on iOS) is told to reopen in the real browser and offered a copy-link button,
  and an already-installed app is told nothing at all.

## The clock, and what a delivery makes (added 2026-08-26)
Three things arrived together because they are the same thing: dispatch could not
say when a stop happened, so it could not say what a stop cost, so it could not
say whether the delivery side made money.

### The times are stamped by the taps, not by the close-out form
`time_in` / `time_out` are what everything downstream reads — hours on the pay
report, minutes per stop, cost against revenue. They used to be written **only**
when somebody filled in the finish form, which meant a driver who tapped Arrived
and then forgot to close out left NO time at all, and a stop closed out an hour
later at the depot recorded that hour as time on site.

- `setJobStatus` now stamps `time_in` on **arrived** and `time_out` on
  **done/failed**, both `COALESCE`d so a replayed tap off the offline queue can
  never move a time already recorded. `completeJob` corrects them; it no longer
  overwrites `time_out` with `now()` when the close-out doesn't state one (a
  completion replayed when the van found signal used to move the finish time).
- **The clock is visible to both people.** The board card shows a live
  "on site 42m" that ticks (`useTicking`, 30s) and turns red past 2½ hours; the
  driver's own stop shows "on site since 2:14pm". A driver who can see minutes
  ticking is a driver who taps Done; nothing on either screen showed them before,
  which is the whole reason the office was retyping times out of WhatsApp.
- **A driver who never closed out an earlier day is told so** — a banner on
  `/driver` over the stops it means.

### The times can be typed in
`setJobTimes` (PATCH `action: 'times'`) — "Set times" / "Fix times" on the job
card, and a `fix` on every row of the **Times** tab. This exists because the real
times ARE known: the drivers post them in the WhatsApp group as they go.

- Times are given as a driver would say them — `08:42`, Toronto local, on the
  stop's own day — and converted in Postgres
  (`($1::date + $2::time) AT TIME ZONE 'America/Toronto'`) so DST is never
  something anyone has to reason about. `''` clears a time; a field left out
  leaves it alone.
- A finish before the start rolls to the **next day** (a 22:40 stop that finished
  at 00:15 finished tomorrow); more than eighteen hours is refused.
- "and mark the stop done" closes it out at the time typed, not at the time the
  office noticed — which is exactly what was wrong with the old workaround.
- Every correction is a `job_events` row with the editor's name on it.
- **The office marking a stop Done now does what the driver's Done does**:
  `markOrderDeliveredForJob` runs from the board too. Only the phone ever called
  it, so a delivery closed out from the office left its Bargain Bay order sitting
  at "out for delivery" — no delivered email, no units in the sold ledger.

### `lib/dispatch-money.js` — the P&L
The **Profit** tab (admin only): daily / weekly / monthly, revenue against cost,
with the stops behind every number.

- **Revenue is what the client pays, whoever the client is.** For an RS Solutions
  job that's `charge_amount`; for a Bargain Bay delivery it's the **delivery fee
  on the order**, because Bargain Bay is just another client whose paperwork
  happens to live in the same database. A charge typed onto a BB job overrides
  the fee — explicit beats inferred.
- **That fee is derived, not stored**:
  `GREATEST(0, total − subtotal + discount − hst)`. The discount term is the
  landmine already documented under Coupons — leave it out and every order with a
  promo on it reports a fee short by the discount.
- **A stop that couldn't be completed earns nothing and is still counted**
  (`COUNTED = status IN ('done','failed')`), because it cost the same driver and
  the same fuel. Leaving failures out was the tidier query and the wrong number.
- **Nothing is invented.** A completed stop with no usable price counts as zero
  AND is reported as unpriced, so a short total can never be mistaken for a
  finished one. Same for unset pay.
- **A delivery fee of ZERO is not a price.** `REVENUE_KNOWN` requires an explicit
  charge or a fee that is actually greater than zero. Having an `order_id` is not
  enough: an **invoice-bridged Bargain Bay order carries its delivery as a line
  INSIDE the subtotal**, so `total − subtotal − hst` comes out at exactly 0 — and
  the first cut counted that as "known", which made every Bargain Bay delivery on
  the live board report revenue 0 with nothing flagged. Set the charge on the
  stop's card instead.
- **Only a duration that makes sense is summed** (`SANE`, and the same clamp in
  `payReport`). Live data had a stop clocked in at 20:28 and out at 17:30 — three
  NEGATIVE hours, one row of which dragged the whole period's total below zero.
  The Times tab flags a backwards clock, and a zero-length one: a close-out that
  happened before times were stamped by the taps wrote `time_in` and `time_out`
  at the same instant, so a real delivery reports zero minutes. Both are numbers
  to correct, never numbers to add up, and `missingTimes` covers both.
- `stopTimes` is the **Times** tab: every stop with its clock, plus the two flags
  worth chasing — finished with no times at all, and clocked in with the day over.

### `dispatch_expenses` — gas
Gas is the third number, and it was recorded nowhere. One dated row per cost
(`gas | tolls | parking | maintenance | rental | helper | other`), enterable from
the **board bar** on the day (⛽ Gas → dated to the board's day, not to `now()`)
and from the Profit tab for any date, because a receipt comes out of the glovebox
on Friday as often as it goes in at the pump.

**It is never split across the day's stops.** A tank goes into a van, not into a
delivery, and dividing it per stop would be a guess dressed up as a figure — so
it lands on the DAY, and the per-driver table says out loud that it is before
fuel.

## How a driver's name got erased off a stop (fixed 2026-08-26)
Ardy's name came off several of Ruban's stops. The stops ended up reading
"Ruban, second person: nobody", and nothing anywhere said Ardy had ever been on
them. The chain, in full, because every link is a rule somebody has to keep:

1. The stop was **Ardy primary, Ruban second**.
2. Ruban's column shows that card — a column holds the stops you own *and* the
   stops you ride on. Somebody tapped ▲ or ▼ in **Ruban's** column.
3. `resequence` ran `UPDATE jobs SET seq, driver_id, job_date` over **every id in
   that column**. The stop's `driver_id` became Ruban — while `driver2_id` was
   *already* Ruban. **One person in both seats**, a state `assignJob` explicitly
   forbids and `resequence` never asked about.
4. From that moment Ardy matched nothing: off the card, off his own column.
5. The next `assignJob` on that stop — the Day picker, either dropdown, anything
   — hit its `nextDrv2 === nextDrv` guard and wrote `driver2_id = NULL`. Ruban
   alone, nobody second, no trace in the columns.

**Three layers now, because one was clearly not enough:**
- **`normalizeCrew(driverId, driver2Id)` is the only place a crew is decided.**
  Same person in both seats → second seat empty; a second seat with nobody in the
  first → nobody. `createJob`, `updateJob` and `assignJob` all call it. Each of
  those had previously reimplemented some subset of the rule, and `resequence`
  had bypassed it entirely.
- **`jobs_crew_distinct`, a CHECK constraint**, is the version that cannot be
  talked out of it. Applied by `enforceCrewRule()` — deliberately its own
  best-effort step *after* the schema string, not another statement inside it,
  because every dispatch surface awaits `ensureJobSchema` and a safety net that
  fails to hang must not take the board down with it.
- **`updateJob` writes both seats or neither.** It used to write `driver2_id`
  alone with no rule attached, so changing the driver on the edit form saved the
  second seat and silently discarded the first.

**Putting the names back.** The columns lost the evidence; `job_events` never
did. `crewLost({from,to})` walks the **whole** trail of `assigned` events for
each stop and reports any driver who appears in it and is not on the job now. The
board banners those, names who is missing, and offers to put them back. It
**reports and offers; it never repairs by itself.**

**Restoring is ADDITIVE, never the old crew wholesale.** Most of what lands in
this list is an ordinary reassignment: a stop that moved from Ruban to Saieasan
reads here as "Ruban came off it", and a one-click "put the old crew back" would
quietly undo a decision somebody made on purpose — verified on the live board,
where two of the three rows found were exactly that. So the missing name goes
into a FREE seat beside whoever is on the stop today, and when both seats are
taken nothing is offered at all: a stop is one van with two names on it, and
there is no third seat.

**LANDMINE — do not "optimise" that to look at the last `assigned` event only.**
That was the first cut, on the reasoning that a deliberate removal writes its own
newer event and would mask itself. It could never fire: **the accidental drop
happens INSIDE `assignJob`** — the guard that empties a duplicate second seat
runs during an ordinary assign call — so the accident writes an `assigned` event
too and is indistinguishable from a decision. Verified against the live board:
RS-1023's trail reads `Ruban + Ardy` then `Ruban`, and the last-entry test
returned zero rows. The log cannot tell intent and the UI must not claim it can;
it says a name came off and leaves the judgement to somebody who knows who was in
the van.

Two things that keep that test honest and must not regress: `assignJob` now
records `#N came off the stop` when it empties a seat, and `mergeDrivers` writes
an `assigned` event on every stop it touches (without it, a merged account reads
as a driver who vanished, and the banner offers to restore an account that no
longer exists).

**Every stop now has a History button** on its card (`jobHistory`, GET
`view=history&jobId=`). `job_events` had recorded every assignment, status move,
payment and correction since dispatch was built and **nothing ever rendered it**,
which is why "his name got erased and I don't know how" had nowhere to look. Ids
are stored (a name would go stale) and swapped for names on the way out.

**LANDMINE — `mergeDrivers`' three UPDATEs are order-dependent** and the
constraint is what turns getting it wrong into an error instead of a silent
duplicate. Clear the second seat on any stop carrying BOTH accounts *first*, then
move the remaining second seats, then the primary seats. Promoting `driver_id`
before clearing the pairs writes the same id into both seats on the way past.

## A driver's phone number changes (fixed 2026-08-26)
This was a known gap with a written "don't do it" attached to it. Everything
about a driver hangs off `users.id` — their stops, their board column, their pay,
their signed PODs — but everything about SIGNING IN is looked up by phone number.
So re-adding somebody on a new number built a **second account**, and from that
moment the same human had two columns on the board, two rows on the pay report,
and half a history in each.

- **`changeDriverPhone` moves the number on the account they already have**
  ("change number" on the roster line). The person, their work and their history
  stay put; only the way in changes. The synthetic
  `driver-<digits>@drivers.bargainbay.ca` email follows the number — unless it is
  already taken, or unless the account has a real address of its own.
- **The old number's keys are torn down**: unused codes retired, live links
  expired. The number usually changes because the PHONE changed, and a link in a
  text on a lost phone is a working key to that driver's stop list. Their own
  signed-in session is deliberately NOT touched — a new SIM in the same hand is
  the ordinary case, and signing somebody out mid-run helps nobody.
- **Adding a name we already have is refused**, with the change-number button
  offered in its place (`DRIVER_NAME_TAKEN`, 409). `force: true` is how the
  office says "genuinely a different person with the same name".
- **`mergeDrivers` is the repair** for a duplicate that already happened: every
  stop (both seats), order and payment moves onto the account being kept, and the
  duplicate is switched off rather than deleted (a `users` row is referenced from
  places that have nothing to do with driving). Offered automatically when a
  number change collides with another driver.

## Two businesses, one codebase — BRANDS
Bargain Bay is the consumer storefront. **RS Solutions is the delivery/service
company** whose clients are other businesses (Transource et al). A client must
never be able to tell they share a codebase — a Transource invoice arriving from
"Bargain Bay" is wrong in a way they notice immediately.

`lib/brands.js` holds the two identities (name, legal, address, HST, contact
email, sender). `invoices.brand` = `'bargain_bay'` (default) | `'rs_solutions'`,
and it drives three things:
- the **From** and **Reply-To** on every invoice email (`sendEmail({ brand })`),
- the **letterhead** in the email body,
- the **hosted invoice page** at `/invoice/[number]`.

Dispatch client invoices (`invoiceClientJobs`) are always `rs_solutions`.
Everything else defaults to `bargain_bay`, so existing behaviour is untouched.

**It is identity only — it must not fork any logic.** An invoice is an invoice;
both brands run the same code.

`rssolutions.ca` already carries a Resend DKIM record, so it sends today.
`RESEND_FROM_RS` overrides the sender if the verified mailbox differs from
`Service@rssolutions.ca`.

### dispatch.rssolutions.ca
`proxy.js` (Next 16's replacement for `middleware.js`) makes the RS host serve
**only dispatch**: `/admin`, `/driver`, `/api`, `/invoice`, `/login`, `/logout`
pass through; everything else redirects to `/admin/dispatch`. Without it the RS
Solutions hostname would happily serve the Bargain Bay storefront — the exact
confusion the separate domain exists to prevent. `bargainbay.ca` returns from the
proxy immediately and is unaffected. Hosts come from `DISPATCH_HOSTS`
(comma-separated, defaults to `dispatch.rssolutions.ca`).

**Do not narrow the allow-list without thinking**: dropping `/api` breaks the
board's own fetches, and dropping `/invoice` strands every RS client following a
link from their invoice email.

Invoice links in emails use `brandFor(invoice.brand).url()`, so an RS invoice
points at dispatch.rssolutions.ca and never at bargainbay.ca (`RS_SITE_URL`
overrides). DNS: CNAME `dispatch` → `c07d32108fe1e3a0.vercel-dns-017.com.` at
GoDaddy, plus a `_vercel` TXT that only existed for ownership verification and
can be deleted.

## LANDMINES (learned the hard way)
1. **`NEXT_PUBLIC_*` vars are inlined at BUILD time.** Adding/changing one requires a FRESH build — a "Redeploy" of an existing/older deployment will NOT pick it up, and Vercel sometimes promotes an out-of-order older build. Fix: push a trivial commit to force a new build that becomes Production. (This exact trap cost us an hour with the pixel.)
2. Don't mark `NEXT_PUBLIC_*` vars "Sensitive" — pointless; their value ships in the public browser bundle by design.
3. **qty-1 one-of-a-kind units** — the reservation lock is essential; never weaken it (double-sell risk).
4. Keep the ads catalog **owned, not Shopify partner-managed**, or you can't run ads from it.
5. `data/catalog.json` can lag; availability is sourced live from Postgres — don't "fix" by trusting the JSON for stock.
6. Some tracker rows have messy/mis-categorized titles (a few units land in a vague "Appliance" category); they render as-is. Clean at the sheet, not in code.
7. Product photos are manufacturer/dealer stock images (AJ Madison, authorized-dealer) — standard for resellers. Don't scrape copyrighted marketplace images.

## What is NOT in this repo
The master tracker sheet/xlsx, Meta/Shopify/Clover/Vercel cloud config, Google Drive image folders, and the broader RS Solutions business docs (policies, brand assets, prospect lists, social calendar, labor tracking) live in the connected "RS Solutions Complete Tracker" folder and external services — not here.
