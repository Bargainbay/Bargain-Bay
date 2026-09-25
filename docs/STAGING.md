# Staging

A place to try a schema change, a refund path or a cron job without doing it to
the business.

## What the code already guarantees

`lib/environment.js` decides what a deployment may touch, from `VERCEL_ENV`.
**Production is unaffected** — every guard is a no-op there, and there is a test
that says so.

| Outbound | Production | Anywhere else |
|---|---|---|
| Email | sent | **redirected** to `STAGING_EMAIL_TO`, subject prefixed with the real recipient. Unset → nothing sent. |
| SMS | sent | **redirected** to `STAGING_SMS_TO`. Unset → nothing sent. |
| Master tracker | written | **refused.** Never redirected. |
| Outbound calls | placed | **refused.** |

The tracker is refused rather than redirected because it is the source of truth
for the whole business, it is not in this repo, and there is no safe second copy.
The block sits in `sheetsClient()` — the one boundary every write passes through
— rather than at each caller, because gating callers was tried first and intake's
`appendTrackerUnits` never consulted the flag.

Every non-production page also carries a purple banner, so nobody reads a
dashboard off staging and quotes the number in a meeting.

## Setting one up

Console work; none of it can be done from the CLI.

### 1. A separate database

Neon → the `bargain-bay` project → **Branches → New branch** from `main`. A Neon
branch is copy-on-write, so it is near-instant and costs almost nothing. Copy its
connection string.

**Never point staging at the production database.** The guards above stop
outbound effects reaching people; they do nothing about a `DELETE` in the wrong
window.

### 2. A Vercel environment

Vercel → `bargain-bay` → **Settings → Environment Variables**, scoped to
**Preview**:

| | |
|---|---|
| `POSTGRES_URL` | the Neon **branch** string |
| `STAGING_EMAIL_TO` | a mailbox the team reads |
| `STAGING_SMS_TO` | one mobile, in E.164 |
| `SITE_URL` | the preview URL |
| `SHEET_WRITEBACK` | leave unset — belt and braces |

Everything else can be inherited. `SENTRY_DSN` is worth setting so staging
errors are visible, and they will carry `environment: preview` so they can be
filtered out of production alerts.

### 3. Turn preview builds back on

**As of 2026-09-25 every pull request reports `Vercel — Canceled by Ignored
Build Step`, so no preview is being built at all.** Whatever is configured under
**Settings → Git → Ignored Build Step** is exiting 0 and cancelling the build.

Until that is changed there is no staging environment, whatever the environment
variables say. Check that setting first.

### 4. Migrate it

```bash
POSTGRES_URL='<the neon branch string>' npm run migrate -- --status
POSTGRES_URL='<the neon branch string>' npm run migrate
```

Rehearsing a migration against the staging branch before production is the whole
reason this exists.

## Refreshing it

Delete the Neon branch and make a new one from `main`. Nothing in the app holds
state outside Postgres and the Blob store, so there is nothing else to reset.

## What is still NOT safe on staging

- **Stripe** uses whatever key is set. Give Preview a test-mode key, or leave
  `STRIPE_SECRET_KEY` unset so the app runs in pay-on-pickup mode.
- **Vercel Blob** is shared unless Preview gets its own `BLOB_READ_WRITE_TOKEN`,
  so photos uploaded on staging land in the production store.
- **QuickBooks and Plaid** would connect to the real accounts if their tokens are
  inherited. Leave them unset on Preview.
