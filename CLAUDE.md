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
- **Everything dispatch does happens on `/admin/dispatch`.** Board, service-call
  queue, and clients/drivers are TABS on that one page, not separate screens, and
  a client can be added from inside the new-job form itself. Do not move any of
  it to another route: sending someone elsewhere to add a client mid-call is the
  friction that sends a dispatcher back to paper.
  `/admin/dispatch/tickets` is only a redirect kept so older links resolve.
- **Both sides of the money live on the job.** `pay_amount` is what it costs us
  (what the driver/tech is owed); `charge_amount` is what the CLIENT pays us.
  Margin per run is therefore visible while it's fresh. Both admin-only.
- **Weekly client invoicing.** The Billing tab lists finished, not-yet-billed jobs
  per client for a period; one button raises a real invoice through
  `createAndSendInvoice` (a line per job, unsent, lands in Invoices and books
  revenue on its date like any other). `jobs.invoice_id` is stamped only AFTER
  the invoice saves, and `setJobCharge` refuses to move a charge once it's set —
  a job can never appear on two invoices. Needs `clients.contact_email`.
- **A job can be a transfer** — `pickup_address` / `pickup_city` /
  `pickup_postal` set means it runs FROM there TO `address`. Shown as "A → B" on
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
