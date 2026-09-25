# Backup and restore

## The thing to understand first

**The business's state is in three separate stores, and only one of them is
backed up by anything today.**

| Store | Holds | Backed up? |
|---|---|---|
| **Postgres** (Neon) | orders, invoices, jobs, customers, consent, the ledger | **Yes** — Neon point-in-time restore, plus `npm run backup` |
| **The master tracker** (Google Sheet) | inventory — the source of truth for what we own and what it cost | **Google's version history only.** Not in this repo, not in any backup we take. |
| **Vercel Blob** | proof-of-delivery **signatures**, delivery photos, unit photos, driver fuel receipts | **No. Nothing backs this up.** |

Postgres stores only the *paths* into Blob. Restoring the database alone gives
you rows pointing at pictures that are gone — including the signed PODs that are
the evidence in a damage claim, and the fuel receipts that are tax records.

That gap is real and is not closed by this document. It is named here so nobody
reads "we have backups" and believes it covers a signature.

---

## Postgres

### Neon's point-in-time restore — the primary mechanism

Neon → the `bargain-bay` project → **Branches → Restore**. Pick a timestamp; Neon
makes a branch at that moment. Nothing is overwritten, so a mistaken restore
costs nothing.

**This is what to reach for first** for anything recent. It is instant, it needs
no files, and it cannot be got wrong.

Its limit is retention: it reaches back as far as the plan allows and no further.
A problem found two months later — a bad import, a mis-priced batch — is outside
it. That is what the file backups below are for.

### Taking one

```bash
POSTGRES_URL='...' npm run backup
# -> backups/bb-2026-09-25-15-30-00.json
```

It prints what it captured and **exits non-zero if the dump is empty**, because
an empty backup that reports success is worse than no backup.

`backups/` is gitignored. A dump contains every customer's name, address, phone
and order history — treat the file as you would the database.

### Checking one, without a database

```bash
npm run backup -- --verify backups/bb-2026-09-25-15-30-00.json
```

Reads the file, reports the tables and row counts, and fails if it holds no rows.
**Run this after every backup.** A backup nobody has opened is a claim.

### Restoring one

```bash
# 1. The target needs the schema. A restore does not build it.
POSTGRES_URL='<target>' npm run migrate

# 2. Then the data.
POSTGRES_URL='<target>' npm run backup -- --restore backups/bb-....json --truncate --yes
```

- `--truncate` empties every table first. Without it, the restore **collides on
  primary keys** rather than silently interleaving two datasets — which is the
  safe outcome, and is tested.
- `--yes` is required. Without it the script prints the target and refuses.
- Sequences are moved past the restored ids automatically. Without that, the
  first new order after a restore dies on a duplicate key — a failure that looks
  like corruption and is merely a counter.
- `schema_migrations` is **not** part of a dump. It describes the target's own
  schema history.

### Practise it on a branch, not on production

Make a Neon branch, restore into that, and look at it. The restore path is
covered by tests that run a real dump and restore against a real Postgres
(`test/backup.test.mjs`) — but a test proves the code works, not that *this*
file restores.

---

## The master tracker

The Google Sheet is the source of truth for inventory: what we own, what it cost,
what condition it is in. It is not in this repo and nothing here backs it up.

What exists: Google's own version history (File → Version history), which is
genuinely good for "somebody pasted over a column an hour ago" and no use at all
if the file is deleted or the account is lost.

**Recommended, not yet done:** a scheduled export to Drive or to the Blob store.
A weekly CSV of the Main tab would cover the case that matters — reconstructing
inventory — and is a small cron job.

Note that a non-production deployment **cannot write to the tracker at all**
(`lib/environment.js`), so a staging mistake can never be the thing you need to
recover from.

---

## Vercel Blob

Holds, keyed from Postgres:

| Prefix | What |
|---|---|
| `products/<sku>-<n>.jpg` | unit photos from vendor intake |
| `<job>/signature.png` | **the customer's signature on a proof of delivery** |
| `<job>/photo-<n>.jpg` | delivery photos |
| `fuel/<date>/receipt.jpg` | driver fuel receipts — tax records |

**Nothing backs this up.** Vercel Blob has no point-in-time restore. A deleted
blob is gone, and the database row that points at it will still be there,
pointing at nothing.

**Recommended, not yet done:** `list()` from `@vercel/blob` and copy to
somewhere else on a schedule. The signatures are the urgent half — they are
evidence, they are small, and there are not many of them.

---

## What to do when something has actually gone wrong

1. **Stop writing.** If a bad import or a bad migration is in flight, that first.
2. **Recent and database-only?** Neon PITR to a branch, look at it, then
   repoint `POSTGRES_URL`. Do not restore over the live branch to check
   something — branch and look.
3. **Older than Neon's retention?** The file backups above, into a *new* Neon
   branch. Never restore a file over the live database as a first move.
4. **Blobs involved?** They are not recoverable. Work out what is referenced but
   missing before telling anyone the restore is complete.
5. **Inventory wrong?** The tracker, not the database. Google's version history.
