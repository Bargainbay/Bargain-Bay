# Bargain Bay — e-commerce storefront

Production storefront for RS Solutions' liquidation appliance business
(Hamilton, ON). Next.js 14 App Router, plain JavaScript, Postgres, Clover
Hosted Checkout, with the master inventory tracker (Google Sheet) as the
source of truth for the catalogue.

## How the pieces fit

```
Master tracker (Google Sheet / xlsx)
        │  scripts/sync-sheet.mjs (cron) — or regenerate from the master xlsx
        ▼
data/catalog.json  (139 one-of-a-kind units)
        │
        ▼
Next.js storefront ── customer checks out ──► order + 30-min SKU reservation (Postgres)
        │                                            │
        │                       CLOVER_PRIVATE_TOKEN set?  ── no ──► order confirmed,
        │                                            │               pay on pickup/delivery
        │                                           yes
        │                                            ▼
        │                                  Clover Hosted Checkout
        │                                            │ webhook on payment
        │                                            ▼
        │                          order → confirmed + writeSold() to the sheet
        ▼
/account · /order/BB-xxxx tracking · /admin fulfilment board
```

## Local dev

```bash
npm install
cp .env.example .env          # fill in what you have (everything is optional locally)
npm run dev                   # http://localhost:3000
```

With **no env vars at all** the site still runs: full catalogue browsing, cart,
and checkout returns a friendly "ordering offline" message. Add `POSTGRES_URL`
to light up accounts, orders, reservations, and admin.

### Database bootstrap

Create a Postgres database (Neon free tier works great), then either:

```bash
psql "$POSTGRES_URL" -f db/schema.sql
```

…or skip psql entirely: deploy, sign up with an `ADMIN_EMAILS` account, open
`/admin`, and click **Run schema migration** (it executes `db/schema.sql` via
`/api/admin/migrate`). Safe to re-run — everything is `IF NOT EXISTS`.

## Environment variables

See `.env.example` for the full annotated list:

| Var | Needed for | Notes |
| --- | --- | --- |
| `POSTGRES_URL` | accounts, orders, reservations, admin | Neon / Vercel Postgres connection string. Site builds and browses without it. |
| `AUTH_SECRET` | login sessions | long random string (`openssl rand -hex 32`) |
| `ADMIN_EMAILS` | `/admin`, `/api/admin/*` | comma-separated emails; each needs a normal account |
| `SITE_URL` | Clover redirects | e.g. `https://bargainbay.org` |
| `CLOVER_ENV` / `CLOVER_MERCHANT_ID` / `CLOVER_PRIVATE_TOKEN` | card payments | leave token blank → pay-on-pickup/delivery mode |
| `CRON_SECRET` | protecting the cleanup cron | optional |
| `GOOGLE_CREDENTIALS` / `SHEET_ID` / `GOOGLE_SHEETS_TAB` | catalog sync + sold write-back | service-account JSON |
| `SHEET_WRITEBACK` | sold write-back | set `1` to let paid orders mark units Sold in the master tracker |
| `IMAGES_BASE_URL` | remote product photos | optional |

## Deploying to Vercel

1. Push this folder to a Git repo and import it into Vercel.
2. Add a Postgres database (Vercel Postgres / Neon integration) — copy its
   connection string into `POSTGRES_URL`, then run the schema bootstrap above.
3. Set `AUTH_SECRET` (random 32+ bytes), `ADMIN_EMAILS`, and
   `SITE_URL=https://bargainbay.org`.
4. Deploy. The site is fully launchable at this point in
   **pay-on-pickup/delivery mode** (orders are confirmed instantly, you collect
   payment in person).
5. Sign up on the live site with the admin email, open `/admin`, and click
   **Run schema migration** to create the tables.
6. `vercel.json` schedules `/api/cron/expire-reservations` daily; abandoned
   checkouts are also cleaned opportunistically on every new checkout, so the
   cron is belt-and-suspenders. Set `CRON_SECRET` to lock the endpoint down.

### Pointing bargainbay.org at Vercel

1. In Vercel → Project → Settings → Domains, add `bargainbay.org` (and
   `www.bargainbay.org`).
2. At the registrar, set the apex `A` record to `76.76.21.21` and the `www`
   `CNAME` to `cname.vercel-dns.com` (Vercel shows the exact values).
3. Wait for DNS + automatic TLS, then set `SITE_URL=https://bargainbay.org`
   and redeploy so Clover redirect URLs use the real domain.

### Turning on Clover payments

1. In the Clover dashboard enable **Ecommerce** and create an API token of type
   **Hosted Checkout** (private token).
2. Set `CLOVER_MERCHANT_ID`, `CLOVER_PRIVATE_TOKEN`, and `CLOVER_ENV=sandbox`
   to test (`production` to go live).
3. Point the Clover webhook at `https://<your-domain>/api/clover-webhook` —
   payment success flips the order to **confirmed** and (if `SHEET_WRITEBACK=1`
   with Google credentials set) writes "Sold" back to the master tracker.
4. Run a sandbox order end-to-end before switching `CLOVER_ENV=production`.
5. TODO before go-live: add webhook signature verification in
   `app/api/clover-webhook/route.js`, and confirm the request schema in
   `lib/clover.js` against your Clover region/account.

## Refreshing the catalogue (`data/catalog.json`)

`data/catalog.json` holds `{ generatedAt, units: [...] }` with one entry per
available unit (`id, make, model, category, title, condition, price, compareAt`).

- **Prod path:** `npm run sync` (runs `scripts/sync-sheet.mjs`) reads available
  units from the master tracker Google Sheet (`GOOGLE_CREDENTIALS` + `SHEET_ID`)
  and rewrites `data/catalog.json`. Run it on a schedule (Vercel Cron or a
  scheduled task) and redeploy/commit the result.
- **Alt path:** the file can also be regenerated straight from the master
  `RS Solutions Master Inventory Tracker.xlsx` (the current snapshot was built
  that way) — any script that emits the same shape works.
- Sold/reserved units are filtered out at request time from Postgres, so the
  catalogue file can lag a little without overselling.

## Photos

Drop real photos at `public/images/<UID>/main.jpg` (e.g.
`public/images/SS-116088-004/main.jpg`) and they automatically replace the
branded per-category placeholder from `public/stock/`. A remote photo store
also works via `IMAGES_BASE_URL`.

## Map of the code

```
app/
  page.jsx                 home: hero, category tiles, newest arrivals, trust strip
  shop/                    full grid + client-side filters/sort
  product/[id]/            product detail + condition explainer + availability
  cart/  checkout/         localStorage cart ('bb_cart'), checkout form
  order/[orderNumber]/     status timeline (owner or ?email= guest access)
  track/                   order lookup form (order # + email)
  account/  login/ signup/ customer accounts (JWT cookie 'bb_session')
  admin/                   order board + reservations + migrate (ADMIN_EMAILS gate)
  contact/  policies/      contact / returns / shipping / privacy / terms
  api/checkout             order + reservation transaction → Clover or confirm
  api/clover-webhook       payment confirmation + sheet write-back
  api/availability         live sold/reserved check for the cart
  api/auth/*               signup / login / logout / me
  api/admin/orders         PATCH order status
  api/admin/reservations   DELETE = release a hold
  api/admin/migrate        run db/schema.sql (idempotent)
  api/cron/expire-reservations  cleanup (also runs opportunistically on checkout)
lib/
  db.js                    lazy pg pool (build never needs POSTGRES_URL)
  auth.js                  bcryptjs + jose sessions
  reservations.js          race-safe 30-min SKU holds (Postgres)
  inventory.js  images.js  catalog + image resolution
  clover.js  sheets.js     Clover Hosted Checkout + master-sheet sync
db/schema.sql              users / orders / order_items / reservations
vercel.json                daily cron for reservation cleanup
```

## Google Merchant Center (free product listings + Shopping ads)

The site exposes a Google Shopping feed at **`/api/merchant-feed`** (RSS 2.0 with the
`xmlns:g` Google namespace). One `<item>` per available unit; units that only have
placeholder SVG art are skipped automatically (Google rejects placeholder images).
Prices are `x.xx CAD`, condition maps New in Box→`new`, Refurbished→`refurbished`,
everything else→`used`.

To connect:

1. Create a Merchant Center account at https://merchants.google.com (use the business
   Google account).
2. **Add & claim the website** — Settings → Business information → Website. Verify via
   the HTML-tag option (paste the tag into `app/layout.jsx` metadata) or via Google
   Search Console if already verified there.
3. Go to **Products → Add products → Add products from a file** (classic: Feeds → `+`).
4. Choose **Scheduled fetch**, name it `bargain-bay-feed`, and set the file URL to
   `https://<SITE_URL>/api/merchant-feed` (e.g. `https://bargain-bay-two.vercel.app/api/merchant-feed`).
5. Set the fetch frequency to **daily** (inventory is one-of-a-kind, so daily keeps
   sold units from showing), country Canada / language English / currency CAD.
6. After the first fetch, fix any item warnings under Products → Diagnostics.

The feed is `force-dynamic`, so every fetch reflects live availability (sold/reserved
units drop out automatically).
