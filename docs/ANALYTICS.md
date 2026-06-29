# Bargain Bay — Owner Analytics Platform

Five dark, period-aware dashboards in the owner portal, built on real data with
honest "coming soon" placeholders for anything not yet captured.

## System architecture

```
Browser ──▶ Next.js 14 App Router (Vercel, RSC)
              │  server components fetch read-models
              ▼
            lib/* read-models ──▶ Neon Postgres (parameterised SQL)
              │
              ├─ analytics.js   period engine + Sales/Fulfilment/Customers/Financial/Marketing read-models
              ├─ finance.js     expenses + ad-spend CRUD, P&L assembly
              ├─ ratings.js     post-delivery CSAT capture + aggregates
              ├─ reps.js        salesperson list + attribution
              └─ settings.js    owner knobs (revenue goal, opening cash, reps)
```

Charts are server-rendered SVG (no chart lib). Interactivity (period filter,
capture editors) is isolated to small `'use client'` components that POST to
admin APIs and call `router.refresh()`.

## File structure (added/changed)

```
app/
  layout.jsx                      → SiteChrome (suppress storefront chrome on /admin)
  admin/
    dashboard/  (Sales)           ← period KPIs, deals, funnel, goal, per-rep
    fulfilment/ (Ops & supply)    ← stages, on-time, pickup/delivery, drivers, POD
    customers/                    ← new/returning, retention, segments, geo, CSAT, DBs
    financial/                    ← margin trend, AR aging, collections, P&L, cash
    marketing/                    ← leads, funnel, ad ROI, campaign sends
  api/admin/
    settings/   (k/v)             expenses/  ad-spend/  order-rep/  reps/
  api/rate/[token]/               public CSAT submit
  rate/[token]/                   public CSAT page
components/
  DashboardShell.jsx  charts.jsx  DashboardFilters.jsx
  GoalEditor.jsx  ExpenseEditor.jsx  AdSpendEditor.jsx  RepSelect.jsx
lib/  analytics.js  finance.js  ratings.js  reps.js  settings.js  dashboards.js
```

## Database schema (new — all self-provisioning, no migration)

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep text;   -- attribution
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sales_rep text;

CREATE TABLE expenses (                 -- operating expenses
  id serial PK, incurred_on date NOT NULL, category text, vendor text,
  amount numeric(10,2) NOT NULL, note text, created_at timestamptz);

CREATE TABLE ad_spend (                 -- marketing spend
  id serial PK, spent_on date NOT NULL, channel text NOT NULL,
  amount numeric(10,2) NOT NULL, campaign text, note text, created_at timestamptz);

CREATE TABLE order_ratings (            -- post-delivery CSAT
  id serial PK, order_id int REFERENCES orders(id) ON DELETE CASCADE,
  rating int CHECK (rating BETWEEN 1 AND 5), comment text, created_at timestamptz);

CREATE TABLE campaign_log (             -- sends (for marketing dashboard)
  id serial PK, channel text, segment text, subject text,
  recipients int, sent int, failed int, created_at timestamptz);

-- settings keys: revenue_goal_monthly (num), opening_cash (num), sales_reps (json[])
```

## API endpoints (admin-gated unless noted)

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/admin/settings` | k/v owner knobs |
| GET/POST/DELETE | `/api/admin/expenses` | operating expenses |
| GET/POST/DELETE | `/api/admin/ad-spend` | ad spend rows |
| POST | `/api/admin/order-rep` | set salesperson on an order |
| GET/POST | `/api/admin/reps` | salesperson list |
| GET/POST | `/api/rate/[token]` *(public)* | submit a delivery rating |

## UI architecture

`DashboardShell` (dark, full-bleed) wraps every dashboard with the 5-tab nav.
Each page is a server component: `auth → load read-model(period) → KPI row +
charts + tables`. Capture editors are client islands. Chart primitives
(`Kpi`, `Donut`, `Funnel`, `TrendChart`, `HBars`) live in `components/charts.jsx`
and are shared across all five.
