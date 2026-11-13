# Aljo Systems lead-partner program — design (DRAFT for approval, 2026-11-12)

Status: **design only, nothing built.** Build starts after the owner approves section 9 (defaults and open decisions).
Build in a fresh worktree off `origin/main` (this checkout is on `invoice-issued-by`, behind main, with a lot of uncommitted work).

## 1. What the owner asked for, in one paragraph

Aljo Systems has ~20 lead generators. Each generator: posts our stock on Facebook, sends us warm leads (by form **or by uploading a
screenshot** that gets read into a lead), has their own online coupon code, and can see what happened to each lead (not numbers).
Our reps (John, Roushi) see the leads as warm leads and work them. A lead already sent by someone else is refused and the sender is
told. Aljo itself sees everything, adds/removes its own generators, signs up resellers (SecondShop-style), and every night sees new
stock and what sold so the Facebook posts can be taken down. Generators never see member/wholesale pricing or any cost.

## 2. Reuse, do not rebuild

| Need | Already built (on `origin/main`) | What changes |
|---|---|---|
| Aljo as an organisation with logins, `/partner`, statement, payments, funnel | `referral_partners`, `partner_members`, `lib/referral-partners.js` (SecondShop) | Add a **role** to `partner_members` (`admin` default = today's behaviour, `affiliate` = new, sees only their own) |
| Reseller sign-up link | `/join/<code>` + approval at `/admin/resellers` | None. Aljo uses the org link; generators do **not** recruit resellers |
| End-user code | `ensureCustomerCoupon` (`SECONDSHOP5`) | One code **per generator** (`ALJO-ANNA5`), attributing to the org **and** the generator |
| Lead tracker, duplicate rule, claim, stages, activity log | Sales Hub `leads`, `lead_activities`, `findDuplicate` | Add partner columns, a partner-aware duplicate path, a "Partner leads" queue |
| Reading a document/image with Claude | `lib/pdf-stops.js` (same API pattern) | New `lib/lead-screenshot.js`, same discipline: proposes, a person confirms |
| Posting kit (title, caption, photos zip) | `lib/fb-kit.js`, `/api/admin/fb-listings/zip` | Affiliate-facing version with their own link/code; posted-ticks move from browser storage to the database |
| Nightly job + health monitoring | `withHeartbeat`, `EXPECTED` in `lib/health.js` | New cron wrapped and registered |

## 3. People and permissions (the biggest place to get this wrong)

Three tiers, enforced **server-side on every route**, identity from the session, never from a request parameter:

1. **Owner/admin and our reps** — existing rules. Roushi's access to partner leads: see decision D2.
2. **Aljo admin** (`partner_members.role = 'admin'`, plus the org's primary login) — sees every generator, every lead and its status,
   duplicate attempts, per-generator conversions, the orders/commission (SecondShop-style, no unit cost), resellers, team management,
   the nightly digest.
3. **Generator** (`role = 'affiliate'`) — sees **only their own** leads and statuses, their own code/visits/sales count, the posting kit,
   their own take-down list, their own notices. **No** money, no commission, no pricing beyond the public price on the units they post,
   no other generator, no team list, no reseller anything.

Rules that must hold, each with a test:
- Every lead/notice/post query is filtered `partner_email = org AND (role = admin OR member_email = me)`. A lead id in a URL belonging to
  someone else returns 404, never 403 (do not confirm it exists).
- Existing SecondShop teammates keep exactly today's behaviour (the new column defaults to `admin`). Test: SecondShop teammate still sees
  the whole org after the migration.
- **Only org admins add/remove generators.** Today any teammate can add logins (`/api/partner/team`); that must be restricted to
  `admin` role or a generator could add 10 friends.
- A generator account is a plain customer `users` row (can shop normally) but is on **no** staff list and cannot be a reseller/member,
  a partner, or on two teams (existing rules, extended).
- Removing a generator: login stops at once (role is checked per request, not cached), their coupon is switched off for new orders,
  their past leads and credit stay on the record. Revoking the org revokes everyone.
- **Self-dealing:** a lead whose email/phone equals any partner login, and an order placed with your own code by your own email/phone,
  earns nothing (same "own" rule affiliates already have).
- Generators never receive cost, profit, member price, clearance floor, rep names or emails, internal notes, or the customer's order
  contents. The screen shows plain statuses only.

## 4. Lead flow

### 4.1 Submitting (form)
One short mobile screen: name, phone **or** email, what they want (pick list → interest tags + side), a short note, and a **"how did they reach you"** pick (message, text, in person, phone). **No consent tick** (owner decision 2026-11-12): the person contacted the generator themselves, which is the inquiry that gives us implied consent to answer them (the same 6-month inquiry window the CRM already uses, `IMPLIED_INQUIRY_MONTHS`). The submitter's name, the time and the "how" are stored with the lead as the record. The guide still tells generators to send only people who reached out to them.

On submit, inside **one transaction**:
1. Normalise (`phoneKey`, lowercased email). Reject malformed phone (not 10-digit NANP) and disposable email.
2. Take an advisory lock on the phone key and the email, **then** run the duplicate check, **then** insert. Without the lock two
   generators submitting the same person at the same second both pass the check (check-then-insert race). Backed by a partial unique
   index on `phone_key` / `lower(email)` for partner leads, so the database refuses the second even if the lock were bypassed.
3. Duplicate = existing lead (any owner, any source, any stage), existing customer, or a login of any partner. **Block.** First in time wins
   (`submitted_at`).
4. Not a duplicate: insert as `source = 'referral'`, `temperature = 'warm'`, owner NULL (partner pool), notices written, reps emailed.

Company-name matching is **not** used for partner leads (people, not firms; a name collision would wrongly block a stranger).

### 4.2 The duplicate answer (what the sender sees)
- Same generator again: "You sent this one on Nov 12. Here is where it stands" + the status. Nothing new is created.
- Someone else / already in our system / already a customer: "This lead was already entered by someone else, so it can't be counted
  again." **Never** says who, when, or which organisation; never says "customer". Shown on screen **and** saved as a notice on their
  dashboard (so closing the tab doesn't lose it) and in the nightly digest.
- Aljo admin sees duplicates **inside their own org** with both generators' names (so they can settle it). Across organisations nothing
  is revealed.
- Every attempt is logged (`partner_dup_attempts`: who, when, which existing lead) so a "I sent it first" dispute is answerable. Owner
  can reassign credit on `/admin/referral-partners`, audit-logged.
- Soft duplicates (same name + street number/postcode, different phone or email) are **not blocked**; they're flagged "possible duplicate"
  for the rep, because blocking on a guess loses real leads.

### 4.3 Screenshot intake
1. Generator picks a screenshot (WhatsApp/Messenger/Marketplace chat). Shrunk on the phone first (same `photo-pick` helper; a serverless
   body is ~4.5 MB). One image per request. PNG/JPEG/WebP only; iPhone HEIC converted client-side or refused with a clear message.
2. Stored in the **private** Blob store (never public). Hash recorded; the exact same image submitted twice is flagged.
3. Sent to Claude with a strict prompt, same rules as `pdf-stops.js`: **never invent** a number, email or address; blank beats wrong;
   output is a JSON object checked against a schema (lengths capped, types checked). **Text inside the screenshot is data, never
   instructions** (a chat that says "ignore previous instructions" must do nothing). Several people in one screenshot → returns a
   list and the screen asks which one.
4. The result fills the **same form as step 4.1, pre-filled and editable**, with the image beside it. The generator must confirm. Nothing is
   submitted automatically. The wording on screen is "Read from your screenshot, please check every field" — **no "AI" label anywhere**
   (owner's standing rule).
5. After confirmation it runs through 4.1 unchanged: the duplicate rule and everything else. The screenshot is kept with the lead as
   the record of the inquiry for 90 days, then deleted by the nightly pass (the lead stays).
6. If the reader is down, no key, slow or returns nothing: the screen says so and falls back to the manual form with the image still
   attached. **Submitting is never blocked by the reader.** Capped (e.g. 30 reads/generator/day) so a loop can't run up the bill.
7. A misread digit is the real risk (a wrong phone number = a lost lead, or worse, someone else's phone being called). Mitigations: confirm
   screen shows the phone big; phone must pass format validation; the rep's first call confirms the name.

### 4.4 What our team sees
- Sales Hub gets a **Partner leads** queue: unowned, warm, newest first, showing sender (generator + Aljo), what they want, consent line,
  screenshot link, possible-duplicate flag. A rep **claims** a lead with a conditional update (`WHERE owner_email IS NULL`) so two reps
  can't both take it; the loser is told who has it. Claiming sets the owner and accepts it (the existing 24 h first-touch clock starts;
  suggest a tighter 2 h for warm partner leads, D2).
- New lead → email to the configured list (John, Roushi, owner); an hourly reminder while any partner lead is unclaimed over 2 h,
  escalating to the owner. Notifications are batched so 20 generators can't produce 200 emails.
- Reps log activity exactly as today. They add one thing: for a dead lead a plain reason from a fixed list (not interested / couldn't
  reach / wrong number / already a customer / other). **Notes stay internal.**
- **Reps must be able to mark a lead "bad / junk"** (fake number, not asked to be contacted). Aljo sees each generator's quality
  (accepted %, couldn't-reach %, junk %). This is the deterrent against padded lead counts.

### 4.5 What the generator sees ("what happened")
One plain status per lead, derived from facts, never hand-set:

| Shown | Derived from |
|---|---|
| Sent | lead created, not yet claimed |
| With our team | claimed/accepted by a rep |
| Called | first real touch logged (call/text/email/WhatsApp/meeting) |
| In conversation | stage conversation / meeting / proposal |
| Quote sent | stage proposal |
| **Sold** | a linked customer has a counted sale (`SALE` predicate, i.e. not cancelled/refunded) |
| **Completed** | that order is `delivered` |
| Not interested / Couldn't reach / Wrong number | lost reasons (mapped, no detail) |
| Not counted | rejected as duplicate or junk |

Each row shows the date of the last change. No amounts, no rep names, no notes.
**"Sold" must be derived, not typed** (the Hub already says Won is never set by hand), so see 5.

## 5. Making "Sold" and the money trustworthy

The chain is lead → customer → order. If a rep forgets to press **Convert**, the sale is invisible and the generator is wrongly told
nothing happened. Guards:
- `convertLead` for a partner lead also stamps the customer: `partner_email = org`, `partner_member_email = generator`
  (`partner_set_by = 'lead'`). An existing customer is never moved (existing rule).
- **Nightly reconcile** links any unconverted partner lead whose email/phone now matches a customer (link only; flags for review).
- **At checkout** (`attachPartnerForOrder`), a buyer whose email/phone matches a partner lead inside the credit window (D4) is attached
  to that partner/generator if they have none. This catches a lead who just goes to the website and buys.
- Credit goes to the **first** submitter (duplicates were blocked, so there is exactly one).
- **Double commission trap:** `convertLead` today makes the rep the customer's owner (their Collected-Sales plan) *and* the partner
  column would earn the partner commission → one account earning on two plans. Decision D3; default: partner-sourced customers are
  **not** given the rep's Employee-Account ownership.
- Commission for the org is computed with the existing `partnerReport` machinery (per order, floored at $0, accrual, earned vs pending
  after delivery). Generators are paid **by Aljo**, not by us. We pay Aljo only; we never see or manage Aljo's internal split.

## 6. Codes and links

- **Org links (Aljo):** reseller link `/join/<code>`, end-user link `/join/<code>/shop` — exactly SecondShop's.
- **Per-generator coupon:** created when Aljo adds the person (e.g. `ALJO-ANNA5`), customer discount = the org's `customer_pct`
  (default 5%), `commission_pct 0` (we pay via the partner system, as SecondShop). Same checkout floors as any typed code. Format:
  upper-case letters/digits, unique across all coupons, no look-alike characters, profanity/collision checked.
- **Per-generator link** `bargainbay.ca/?ref=ALJO-ANNA5` (and `/product/<id>?ref=...`), already understood by `RefCapture`.
- Attribution: coupon on the order → org + generator; else the 30-day cookie/ref; else the lead match (5). The **most recent valid**
  generator code wins only if the customer has no partner yet (never re-assigned).
- Visits per generator are counted (existing daily-per-browser rule). Visits ≠ conversions, labelled.
- A suspended generator's code stops applying to **new** orders; orders already attributed keep their credit.

## 7. Posting material and the nightly take-down list

- **Posting kit** for generators = `lib/fb-kit.js` plus: caption ends with **their** code/link (not "message me"), uses the public price
  only (via `decorate`; never member/clearance-floor/cost), our own stock only, real unit photos when we have them, stock photo
  otherwise, zip download for photos. Required disclosure lines (condition, one-year warranty, pickup Pickering / delivery priced by
  distance) come from the same constants as the site so a caption can't promise something the shop doesn't.
- **"I posted this"** is a database record per generator and unit (`affiliate_posts`), not browser storage — 20 people, several devices.
- **Take-down list = units this generator marked posted that are no longer on sale.** That is precise (they see *their* items, not 400
  others) and is exactly "see what's sold so they can take the listing down".
- "No longer on sale" means **sold, delisted, or held by an order** — **not** a 30-minute cart reservation. (`unavailableSkus` includes
  cart holds; using it as-is would tell 20 people to delete a listing every time someone opens checkout.) A unit that comes back
  (hold lapsed) shows "back on sale".
- **New items** = SKUs on sale tonight that weren't on sale last night. `products` has no arrival date (every sync rewrites
  `synced_at`), so keep a tiny `stock_daily(day, skus[])` snapshot written by the nightly job and diff day over day (the same SKU-set
  method the member portal's "new since your last visit" already uses). First run flags nothing as new.
- **Nightly email** (~7 pm Toronto, own cron entry, wrapped in `withHeartbeat`, added to `EXPECTED`): to each generator, their take-down
  list and the count/link of new items; to Aljo admins, a team roll-up. It is a service message about their own work, not marketing.
  Sent only if there is something to say; idempotent per recipient per day; a failed send is recorded, not silently dropped; staging
  never emails real people (existing guard). The same lists are live on the dashboard all day.
- Staleness: stock reflects the last tracker sync. The page shows "stock as of <time>" and the guide says to re-check the page before
  posting. A unit sold at the counter between syncs is a window we can't close, only narrow.

## 8. Failure modes and the guard for each

| # | What can go wrong | Guard |
|---|---|---|
| 1 | Two generators send the same lead at the same second | advisory lock + unique partial index + test of the normal path (PGlite is single-connection so the race itself is untestable; same caveat as the marketplace) |
| 2 | Same person, phone written 3 ways | `phoneKey` E.164 folding; tested with spaces, dashes, +1, brackets |
| 3 | Same person, one gave email, the other phone | can't match; soft-duplicate flag on name+address; rep decides |
| 4 | Generator learns who else knows the customer | message never names anyone; cross-org nothing; 404 not 403 |
| 5 | Generator A reads generator B's leads (IDOR) | server filter on every query; test calls every route as A for B's ids |
| 6 | Generator sees pricing/cost/commission | status-only DTOs built server-side; test greps responses for cost/price/commission keys |
| 7 | SecondShop's behaviour changes | role defaults to `admin`; regression test for SecondShop teammate |
| 8 | A generator adds friends | team routes require admin role |
| 9 | Fake leads to farm credit | valid phone, rate limit, junk marking, per-generator quality stats, paid only on real sales |
| 10 | A lead who never contacted the generator | inquiry-based consent per owner; "how did they reach you" and the screenshot are stored; the guide forbids list-scraped names; reps can mark a lead junk and Aljo sees quality per generator |
| 11 | Screenshot misread | confirm screen, format validation, nothing auto-submitted |
| 12 | Text in screenshot tries to steer the reader | output treated as data, schema-checked, no tools given to the reader |
| 13 | Reader down / slow / cost runaway | manual fallback, per-day cap, timeouts |
| 14 | Screenshot holds a third party's data | private store, 90-day deletion, access only reps/admin/Aljo for own org |
| 15 | Rep forgets Convert → sale invisible | convert stamps partner; nightly reconcile; checkout match |
| 16 | Customer earns rep commission AND partner commission | D3 |
| 17 | Two reps claim one lead | conditional claim update |
| 18 | Lead sits unclaimed | emails + hourly reminder + owner escalation |
| 19 | 20 generators = email flood | batching/digest, one escalation |
| 20 | Sold unit still posted | per-generator take-down list + nightly email; "stock as of" |
| 21 | Cart hold flicker triggers take-downs | gone = sold/delisted/order-held only |
| 22 | Cron stops silently | `withHeartbeat` + `EXPECTED` + daily health email |
| 23 | Generator quits | remove login; coupon off for new orders; history stays |
| 24 | Coupon code collision/typo/offensive | uniqueness, charset, generated with a suffix check |
| 25 | Generator buys with own code | own-email/phone rule: no credit |
| 26 | Generator submits Aljo staff / themselves | login emails/phones refused as leads |
| 27 | Price mismatch between post and site | posts use `decorate` price; guide says never edit the price |
| 28 | Facebook flags 20 accounts for posting the same photo | guide: real photos, vary text, one listing per item per account, their own account rules; this is their risk, stated plainly |
| 29 | Inquiry record lost | stored with the lead, not in the browser |
| 30 | Old lost lead blocks a re-engaged one | D5 (default: block; reported) |
| 31 | The 3,000 RS Ops leads cause many "already in our system" | expected; stated in the guide; D5 |
| 32 | Partner marketing emails break CASL | nightly digest is a service message; anything promotional goes through `filterAudience` |
| 33 | Wrong thing shown as "Sold" | derived from `SALE`, refund/cancel drops it back automatically |
| 34 | Migration number clash | next free is 0067; runner keys on filename; verify at build time |
| 35 | A reseller Aljo signs up sees another partner's data | existing per-partner scoping from the session, unchanged |

## 9. Defaults I will use unless told otherwise, and the decisions that are the owner's

| # | Decision | My default |
|---|---|---|
| D1 | What Aljo earns (DECIDED 2026-11-12) | A percentage of **our PROFIT** on the order, SecondShop-style (profit = what we sold it for less its cost, after any discount we gave, so a cheaper sale means less commission; floored at $0 per order). Defaults: **reseller sales 15%, end-user-code sales 10% (15% less the 5% customer discount, as SecondShop derives it), leads our reps close 10%**. All editable per partner at `/admin/referral-partners`. Needs a new `lead_pct` setting. |
| D1b | How long a customer stays Aljo's | Same as SecondShop (stays under the partner) for orders; a *lead* has 90 days to its first purchase to be credited |
| D2 | Who works the leads | Unclaimed "Partner leads" queue, John and Roushi claim; 2 h first-touch target; Roushi needs Hub access (is he a Sales Hub rep? granting `sales_rep` also shows him cost, so say if you'd rather I build a narrower staff-level queue) |
| D3 | Rep commission on partner-sourced customers | None (partner plan only), so no account earns twice |
| D4 | Credit window | 90 days |
| D5 | A lead we already have (including old lost ones and the RS Ops import) | Blocked, whatever its age; I report how many are blocked so you can tell me to loosen it |
| D6 | Screenshot retention | 90 days, then deleted (lead kept) |
| D7 | Generators and resellers | Only Aljo (org admins) sign up resellers; generators do not |
| D8 | Who gets the nightly email | each generator (their list) + Aljo admins (roll-up); owner not copied |

## 10. Build order (each a separate PR, each shippable and tested)

1. **Foundation:** migration `0067` (partner roles on `partner_members`, lead partner columns, notices, dup attempts, indexes),
   org/affiliate scoping, add/remove generators, isolation + SecondShop regression tests.
2. **Lead submit + duplicates + queue + status:** form, duplicate rule with lock, notices, Partner leads queue and claim, status mapping,
   Aljo's all-leads view, emails.
3. **Per-generator codes + attribution** (checkout, lead match, nightly reconcile) and Aljo's conversion/commission view.
4. **Screenshot reader.**
5. **Posting kit, "I posted this", take-down list, nightly email.**
6. **Guides finalised** with the real rates and screenshots, converted to PDF/Google Doc for Aljo.

After each: owner presses **Run schema migration**, and `CLAUDE.md` + `OPERATIONS-STATE.md` are updated.

## 11. Not in v1 (say so out loud)
Paying individual generators from our side; generators recruiting resellers; per-generator reseller links; reviving old lost leads for
credit; click-level attribution beyond one visit per browser per day; an SMS to the generator; Facebook automation of any kind
(Meta forbids scripting it, and the owner posts by hand too).
