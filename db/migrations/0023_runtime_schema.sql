-- The tables and columns that used to be created ONLY at runtime.
--
-- 68 blocks of DDL lifted verbatim from the ensureXSchema() functions in lib/ (and the
-- three that live in orders / attribution / reps), so that a database built from migrations alone
-- (staging, a restore target, a new client) is the same shape as production.
--
-- EVERY statement is idempotent (IF NOT EXISTS, or DROP CONSTRAINT IF EXISTS then re-add), and the
-- runtime functions are deliberately LEFT IN PLACE: against the live database this migration is a
-- no-op, and nothing about how the app boots has changed. test/runtime-schema.test.mjs fails if code
-- starts using a table that neither the migrations nor this file create.
--
-- jobs_type_check lists the four job types as of this migration. The runtime ensureJobSchema() still
-- rewrites it from JOB_TYPES on every boot, so that remains the authority when a type is added.

-- ---- from lib/accountants.js
CREATE TABLE IF NOT EXISTS accountant_access (
        email      text PRIMARY KEY,
        name       text,
        note       text,
        granted_by text,
        granted_at timestamptz NOT NULL DEFAULT now(),
        -- Revoking sets this rather than deleting the row: who had the books,
        -- and when, is exactly the sort of thing somebody asks about later.
        revoked_at timestamptz,
        revoked_by text
      );

-- ---- from lib/agents/autonomy.js
CREATE TABLE IF NOT EXISTS sarah_agent_settings (
        agent_key text PRIMARY KEY,
        autonomy_level text NOT NULL DEFAULT 'advise',
        updated_at timestamptz NOT NULL DEFAULT now()
      );

-- ---- from lib/antifraud.js
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ip text;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_agent text;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS verify_token text;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS verified_at timestamptz;
      CREATE INDEX IF NOT EXISTS idx_orders_ip ON orders(ip);
      CREATE INDEX IF NOT EXISTS idx_orders_verify_token ON orders(verify_token);
      CREATE TABLE IF NOT EXISTS blocklist (
        id         serial PRIMARY KEY,
        kind       text NOT NULL CHECK (kind IN ('email','domain','ip','phone')),
        value      text NOT NULL,
        note       text,
        created_at timestamptz DEFAULT now(),
        UNIQUE (kind, value)
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip text;

-- ---- from lib/assistant/store.js
CREATE TABLE IF NOT EXISTS assistant_threads (
        id          bigserial PRIMARY KEY,
        person_key  text NOT NULL,
        person_name text,
        channel     text,
        lang        text,
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_assistant_threads_person ON assistant_threads (person_key, updated_at DESC);
      CREATE TABLE IF NOT EXISTS assistant_messages (
        id         bigserial PRIMARY KEY,
        thread_id  bigint NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
        role       text NOT NULL,
        content    text NOT NULL,
        lang       text,
        via        text,
        actions    jsonb,
        at         timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread ON assistant_messages (thread_id, id);
      CREATE TABLE IF NOT EXISTS assistant_pending (
        id          text PRIMARY KEY,
        person_key  text NOT NULL,
        thread_id   bigint,
        request_id  text NOT NULL,
        tool        text NOT NULL,
        input       jsonb NOT NULL,
        readback    text NOT NULL,
        status      text NOT NULL DEFAULT 'pending',
        result      jsonb,
        created_at  timestamptz NOT NULL DEFAULT now(),
        decided_at  timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_assistant_pending_thread ON assistant_pending (thread_id, status);
      CREATE TABLE IF NOT EXISTS assistant_prefs (
        person_key text PRIMARY KEY,
        banter     boolean NOT NULL DEFAULT true,
        updated_at timestamptz NOT NULL DEFAULT now()
      );

-- ---- from lib/attribution.js
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source text;

-- ---- from lib/attribution.js
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_campaign text;

-- ---- from lib/attribution.js
ALTER TABLE orders ADD COLUMN IF NOT EXISTS referrer text;

-- ---- from lib/attribution.js
ALTER TABLE orders ADD COLUMN IF NOT EXISTS lead_source text;

-- ---- from lib/attribution.js
ALTER TABLE orders ADD COLUMN IF NOT EXISTS lead_by text;

-- ---- from lib/attribution.js
CREATE INDEX IF NOT EXISTS idx_orders_lead_source ON orders(lead_source);

-- ---- from lib/auth.js
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version int NOT NULL DEFAULT 0;

-- ---- from lib/campaigns.js
CREATE TABLE IF NOT EXISTS campaign_log (
    id serial PRIMARY KEY, channel text, segment text, subject text,
    recipients int, sent int, failed int, created_at timestamptz DEFAULT now()
  );

-- ---- from lib/consent.js
CREATE TABLE IF NOT EXISTS consent_events (
        id serial PRIMARY KEY,
        identity text NOT NULL,
        channel  text NOT NULL,
        event    text NOT NULL,
        source   text,
        evidence text,
        ip       text,
        actor    text,
        at       timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_consent_identity
        ON consent_events (identity, channel, at DESC);

-- ---- from lib/consignment.js
CREATE TABLE IF NOT EXISTS consignment_units (
        sku         text PRIMARY KEY,
        vendor      text,
        cost        numeric(10,2),
        taken_on    date NOT NULL DEFAULT current_date,
        paid_on     date,
        paid_amount numeric(10,2),
        note        text,
        created_by  text,
        created_at  timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_consignment_unpaid ON consignment_units(paid_on) WHERE paid_on IS NULL;

-- ---- from lib/coupons.js
CREATE TABLE IF NOT EXISTS coupons (
        id                serial PRIMARY KEY,
        code              text NOT NULL,
        affiliate         text,                       -- who the code belongs to
        commission_pct    numeric(5,2) NOT NULL DEFAULT 0, -- what they earn on it (reporting only)
        kind              text NOT NULL DEFAULT 'percent' CHECK (kind IN ('percent','amount')),
        value             numeric(10,2) NOT NULL,
        active            boolean NOT NULL DEFAULT true,
        starts_at         date,
        ends_at           date,
        min_subtotal      numeric(10,2) NOT NULL DEFAULT 0,
        max_uses          int,                        -- null = unlimited
        per_email_limit   int,                        -- null = unlimited per customer
        exclude_clearance boolean NOT NULL DEFAULT false,
        note              text,
        used_count        int NOT NULL DEFAULT 0,
        created_at        timestamptz NOT NULL DEFAULT now()
      );
      -- The code is the identity, case-insensitively: 'dave10' and 'DAVE10' are
      -- the same coupon or the affiliate report splits in two.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_coupons_code ON coupons(upper(code));
      -- One row per use. Keeps the affiliate report honest even after a coupon is
      -- edited or retired, so the affiliate is snapshotted here, not joined.
      CREATE TABLE IF NOT EXISTS coupon_redemptions (
        id         serial PRIMARY KEY,
        coupon_id  int NOT NULL,
        code       text NOT NULL,
        affiliate  text,
        order_id   int,
        email      text,
        subtotal   numeric(10,2),
        discount   numeric(10,2) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_coupon ON coupon_redemptions(coupon_id);
      CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_order  ON coupon_redemptions(order_id);
      -- What the storefront charged. Stored on the order so every downstream
      -- reader (order page, packing slip, dashboards) sees the same number
      -- without re-deriving it — the delivery fee is otherwise inferred from
      -- total − subtotal − hst, which a discount would silently corrupt.
      -- A promotion that applies by itself from the cart (no code typed): the best
      -- qualifying one wins. Codes are for referrals and one-offs.
      ALTER TABLE coupons ADD COLUMN IF NOT EXISTS auto_apply boolean NOT NULL DEFAULT false;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code text;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount numeric(10,2) NOT NULL DEFAULT 0;

-- ---- from lib/customers.js
CREATE TABLE IF NOT EXISTS customers (
        id serial PRIMARY KEY,
        email text,
        name text, phone text, phone_key text,
        address text, city text, postal text,
        notes text,
        user_id int,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      -- Mirrors db/migrations/0003_customer_identity.sql for a database that
      -- has not had the migrations run. Email is NOT unique-by-column any more:
      -- it is nullable, so the uniqueness has to be partial.
      ALTER TABLE customers ALTER COLUMN email DROP NOT NULL;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_key text;
      ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_email_key;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_live
        ON customers (email) WHERE email IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_phone_key_live
        ON customers (phone_key) WHERE email IS NULL AND phone_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_customers_phone_key ON customers (phone_key);
      CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (lower(name));
      -- Mirrors db/migrations/0004_customer_aliases.sql.
      CREATE TABLE IF NOT EXISTS customer_aliases (
        id               serial PRIMARY KEY,
        customer_id      int NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        kind             text NOT NULL CHECK (kind IN ('email', 'phone')),
        value            text NOT NULL,
        from_customer_id int,
        note             text,
        merged_by        text,
        created_at       timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_alias_value ON customer_aliases (kind, value);
      CREATE INDEX IF NOT EXISTS idx_customer_alias_customer ON customer_aliases (customer_id);
      -- Mirrors db/migrations/0005_customer_activity.sql. Provisioned HERE and
      -- not only in lib/crm because mergeCustomers has to move their rows, and
      -- a merge that dies on a missing table is worse than no timeline.
      CREATE TABLE IF NOT EXISTS customer_activity (
        id serial PRIMARY KEY,
        customer_id int NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        kind text NOT NULL, body text NOT NULL,
        by_email text, by_name text,
        at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_customer_activity_customer ON customer_activity (customer_id, at DESC);
      CREATE TABLE IF NOT EXISTS customer_tasks (
        id serial PRIMARY KEY,
        customer_id int NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        title text NOT NULL, note text, due_on date,
        owner_email text, created_by text,
        created_at timestamptz NOT NULL DEFAULT now(),
        done_at timestamptz, done_by text, outcome text
      );
      CREATE INDEX IF NOT EXISTS idx_customer_tasks_open ON customer_tasks (due_on, owner_email) WHERE done_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_customer_tasks_customer ON customer_tasks (customer_id, created_at DESC);

-- ---- from lib/customers.js
CREATE INDEX IF NOT EXISTS idx_orders_email_lower   ON orders   (lower(email));

-- ---- from lib/customers.js
CREATE INDEX IF NOT EXISTS idx_invoices_email_lower ON invoices (lower(email));

-- ---- from lib/customers.js
CREATE INDEX IF NOT EXISTS idx_quotes_email_lower   ON quotes   (lower(email));

-- ---- from lib/customers.js
CREATE INDEX IF NOT EXISTS idx_orders_status_created ON orders (status, created_at DESC);

-- ---- from lib/dispatch-money.js
-- Money the day cost that isn't attached to any one stop. Gas, overwhelmingly:
      -- a tank goes into a van, not into a delivery, and splitting it across the
      -- stops would be a guess dressed up as a figure. It is dated, not
      -- timestamped, because that is how a receipt works and how the office will
      -- enter it — often days later, out of the glovebox.
      CREATE TABLE IF NOT EXISTS dispatch_expenses (
        id serial PRIMARY KEY,
        expense_date date NOT NULL,
        kind text NOT NULL DEFAULT 'gas',
        amount numeric(10,2) NOT NULL,
        driver_id int,
        note text,
        created_by text, created_by_name text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_dispatch_expenses_date ON dispatch_expenses(expense_date);

-- ---- from lib/dispatchers.js
CREATE TABLE IF NOT EXISTS dispatch_access (
        email      text PRIMARY KEY,
        name       text,
        note       text,
        granted_by text,
        granted_at timestamptz NOT NULL DEFAULT now(),
        -- Revoking sets this rather than deleting the row. Who had the board,
        -- and when, is exactly what somebody asks about after a bad week.
        revoked_at timestamptz,
        revoked_by text
      );
      -- When they finished the walkthrough. Per PERSON, in the database, and
      -- deliberately NOT in the browser: the warehouse machine is shared and
      -- signed in and out all day (which is why this portal has a Sign out
      -- button at all), so localStorage would hide the tour from whoever sat
      -- down next and show it to her again the first time she opened the board
      -- on her own phone. NULL means they have not been walked through it yet.
      ALTER TABLE dispatch_access ADD COLUMN IF NOT EXISTS tour_seen_at timestamptz;

-- ---- from lib/driver-location.js
CREATE TABLE IF NOT EXISTS driver_pings (
        id bigserial PRIMARY KEY,
        user_id  int NOT NULL,
        job_id   int,
        lat      numeric(9,6) NOT NULL,
        lng      numeric(9,6) NOT NULL,
        accuracy_m int,
        speed_kmh  numeric(6,2),
        heading    int,
        source   text NOT NULL DEFAULT 'watch',
        at       timestamptz NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_driver_pings_user_at ON driver_pings(user_id, at DESC);
      CREATE INDEX IF NOT EXISTS idx_driver_pings_at ON driver_pings(at);
      -- A ping can now come from a TRUCK instead of a phone. Same table because
      -- it is the same thing — a position with the device's own timestamp on it,
      -- aged on every read — but the subject is a vehicle, never a person. The
      -- shortcut here would have been a fake driver account called "Box truck";
      -- it would also have put a phantom person in the roster, the Pay tab, both
      -- board columns, mergeDrivers and crewLost's missing-name banner.
      ALTER TABLE driver_pings ALTER COLUMN user_id DROP NOT NULL;
      ALTER TABLE driver_pings ADD COLUMN IF NOT EXISTS vehicle_id  int;
      ALTER TABLE driver_pings ADD COLUMN IF NOT EXISTS battery_pct int;
      CREATE INDEX IF NOT EXISTS idx_driver_pings_vehicle_at
        ON driver_pings(vehicle_id, at DESC) WHERE vehicle_id IS NOT NULL;
      -- THE DEDUPE, and it is load-bearing. We poll PAJ far more often than the
      -- device reports, so one position would otherwise land three or four times
      -- and the trail would grow a pile at every red light. It also makes the
      -- backfill free to re-read an overlapping window, which is what lets it
      -- ask for everything since the last ping without keeping a cursor.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_pings_vehicle_dedupe
        ON driver_pings(vehicle_id, at) WHERE vehicle_id IS NOT NULL;

-- ---- from lib/driver-location.js
DO $subject$ BEGIN
        ALTER TABLE driver_pings ADD CONSTRAINT driver_pings_subject
          CHECK (user_id IS NOT NULL OR vehicle_id IS NOT NULL);
      EXCEPTION WHEN duplicate_object THEN NULL; END $subject$;

-- ---- from lib/drivers.js
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_driver boolean NOT NULL DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS driver_last_seen timestamptz;
      CREATE TABLE IF NOT EXISTS driver_links (
        id serial PRIMARY KEY,
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash text NOT NULL UNIQUE,
        sent_to text,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        used_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_driver_links_user ON driver_links(user_id);
      -- Sign in by typing your own mobile and the 6 digits we text back. The
      -- texted LINK is for the first day; this is for every day after it, and
      -- needs nobody in the office.
      CREATE TABLE IF NOT EXISTS driver_codes (
        id serial PRIMARY KEY,
        user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash text NOT NULL,
        sent_to text,
        attempts int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL,
        used_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_driver_codes_user ON driver_codes(user_id, created_at DESC);

-- ---- from lib/drivers.js
ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate numeric(8,2);

-- ---- from lib/escalations.js
CREATE TABLE IF NOT EXISTS escalations (
    id serial PRIMARY KEY,
    origin_chat_id text,
    dept text,
    question text NOT NULL,
    mgmt_message_id text,
    status text NOT NULL DEFAULT 'open',
    answer text,
    created_at timestamptz DEFAULT now(),
    answered_at timestamptz
  );

-- ---- from lib/finance.js
CREATE TABLE IF NOT EXISTS expenses (
      id serial PRIMARY KEY,
      incurred_on date NOT NULL,
      category text,
      vendor text,
      amount numeric(10,2) NOT NULL,
      note text,
      created_at timestamptz DEFAULT now()
    );

-- ---- from lib/finance.js
CREATE TABLE IF NOT EXISTS ad_spend (
      id serial PRIMARY KEY,
      spent_on date NOT NULL,
      channel text NOT NULL,
      amount numeric(10,2) NOT NULL,
      campaign text,
      note text,
      created_at timestamptz DEFAULT now()
    );

-- ---- from lib/finance.js
ALTER TABLE ad_spend ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

-- ---- from lib/finance.js
ALTER TABLE ad_spend ADD COLUMN IF NOT EXISTS ext_id text;

-- ---- from lib/finance.js
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_spend_ext ON ad_spend(ext_id) WHERE ext_id IS NOT NULL;

-- ---- from lib/finance.js
CREATE TABLE IF NOT EXISTS recurring_expenses (
      id serial PRIMARY KEY,
      category text,
      vendor text,
      amount numeric(10,2) NOT NULL,
      cadence text NOT NULL DEFAULT 'monthly',  -- 'monthly' (on day_of, 1-28) | 'weekly' (every Monday)
      day_of int DEFAULT 1,
      note text,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz DEFAULT now()
    );

-- ---- from lib/finance.js
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurring_id int;

-- ---- from lib/finance.js
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

-- ---- from lib/finance.js
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS ext_id text;

-- ---- from lib/finance.js
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_ext ON expenses(ext_id) WHERE ext_id IS NOT NULL;

-- ---- from lib/finance.js
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tax numeric(10,2);

-- ---- from lib/finance.js
ALTER TABLE ad_spend ADD COLUMN IF NOT EXISTS tax numeric(10,2);

-- ---- from lib/finance.js
CREATE TABLE IF NOT EXISTS purchase_invoices (
      id serial PRIMARY KEY,
      vendor text,
      invoice_number text,
      invoice_date date NOT NULL,
      subtotal numeric(10,2),
      tax numeric(10,2) NOT NULL DEFAULT 0,
      total numeric(10,2),
      units int NOT NULL DEFAULT 0,
      note text,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

-- ---- from lib/finance.js
CREATE TABLE IF NOT EXISTS expense_rules (
      id serial PRIMARY KEY,
      match_text text NOT NULL,
      category   text,
      tax_mode   text,
      hits       int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );

-- ---- from lib/finance.js
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_rules_match ON expense_rules (lower(match_text));

-- ---- from lib/finance.js
ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS paid_at date;

-- ---- from lib/finance.js
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_invoices_ref
             ON purchase_invoices (lower(COALESCE(vendor,'')), lower(invoice_number))
           WHERE invoice_number IS NOT NULL AND invoice_number <> '';

-- ---- from lib/import-batches.js
CREATE TABLE IF NOT EXISTS import_batches (
        id serial PRIMARY KEY,
        batch_number text UNIQUE,
        status text NOT NULL DEFAULT 'draft',
        source_name text,
        read_as text,
        client_id int,
        job_date date,
        quebec_rule boolean NOT NULL DEFAULT true,
        headers jsonb NOT NULL DEFAULT '[]'::jsonb,
        rows jsonb NOT NULL DEFAULT '[]'::jsonb,
        mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
        -- Per-row corrections, keyed by row index: an address read out over the
        -- phone, a client set on one stop, a row dropped. Kept SEPARATE from
        -- the rows themselves so the sheet as it arrived is never overwritten —
        -- "what did their spreadsheet actually say" is the first question asked
        -- when a stop turns out wrong.
        overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
        fingerprint text,
        note text,
        created_by text, created_by_name text,
        created_at timestamptz DEFAULT now(),
        decided_at timestamptz,
        job_ids int[]
      );
      CREATE INDEX IF NOT EXISTS idx_import_batches_open
        ON import_batches (created_at DESC) WHERE status = 'draft';

      -- What a client's spreadsheet looks like, remembered.
      CREATE TABLE IF NOT EXISTS client_sheet_profiles (
        id serial PRIMARY KEY,
        fingerprint text NOT NULL UNIQUE,
        client_id int,
        headers jsonb,
        mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
        defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
        hits int NOT NULL DEFAULT 1,
        last_used timestamptz DEFAULT now(),
        updated_by text
      );

      -- The other names a client goes by. Learned from answers, never invented:
      -- somebody says "yes, CDA is Canadian Discount Appliances" exactly once.
      CREATE TABLE IF NOT EXISTS client_aliases (
        id serial PRIMARY KEY,
        client_id int NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        alias text NOT NULL,
        alias_norm text NOT NULL,
        created_by text,
        created_at timestamptz DEFAULT now(),
        UNIQUE (client_id, alias_norm)
      );

-- ---- from lib/import-batches.js
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS source_msg_id text;

-- ---- from lib/import-batches.js
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_batches_src
                           ON import_batches (source_msg_id) WHERE source_msg_id IS NOT NULL;

-- ---- from lib/import-call.js
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS call_sid text;
      ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS call_to text;
      ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS call_log jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---- from lib/intake-queue.js
CREATE TABLE IF NOT EXISTS intake_queue (
      id serial PRIMARY KEY,
      source text,                 -- 'email' | 'upload'
      email_msg_id text,           -- gmail message id (idempotency key for email)
      vendor text, invoice text, sender text, subject text,
      items jsonb NOT NULL DEFAULT '[]',
      status text NOT NULL DEFAULT 'pending',  -- pending | committed | rejected
      added_skus jsonb,
      note text,
      created_at timestamptz DEFAULT now(),
      reviewed_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_intake_queue_msg ON intake_queue (email_msg_id) WHERE email_msg_id IS NOT NULL;

-- ---- from lib/invoices.js
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_method text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS address  text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS city     text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS postal   text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS phone    text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_id int;
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS kind text;            -- 'unit' (default) | 'service'
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS warranty_months int;  -- 3 | 6 | 12 | 24, null = no warranty
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS cost numeric(10,2);    -- captured unit cost when not in the tracker
      -- The figure the rep TYPED on a tax-inclusive invoice, signed like amount.
      -- amount is always pre-tax, and grossing it back up doesn't reliably return
      -- what was keyed: the tax-in split moves a rounding cent onto the largest
      -- line, so a $750 washer reopened as $749.99. Null on a before-tax invoice,
      -- where amount already IS what was typed, and on anything raised before
      -- this column existed (those still fall back to grossing up).
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS typed_amount numeric(10,2);
      -- Why an appliance line has no stock unit ("customer's own machine", "special
      -- order"). The invoice form insists a unit line is PICKED from stock; this is
      -- the rep's stated reason for the exception, and the stock-gaps report lists
      -- every one of them. See lib/stock-reconcile.js.
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS off_stock_reason text;
      ALTER TABLE order_items   ADD COLUMN IF NOT EXISTS cost numeric(10,2);    -- effective unit cost on the sale (overrides products.cost)
      -- Mirrors invoice_items.kind: 'unit' | 'service' | 'discount' | 'trade_in'.
      -- Without it an order can't tell an appliance being delivered from a
      -- trade-in being collected — they are both just rows with a title and a
      -- price, and the dispatch board has to know the difference.
      ALTER TABLE order_items   ADD COLUMN IF NOT EXISTS kind text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refunded_at timestamptz;   -- set when a paid invoice is refunded
      ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS refunded_at timestamptz; -- set per line on a partial (per-unit) refund
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS refund_total numeric(10,2) NOT NULL DEFAULT 0; -- money returned so far (incl. HST share)
      -- Allow the 'refunded' and 'partial' statuses (the original CHECK only
      -- permitted open/paid/void). 'partial' = some money received (deposit /
      -- instalment) but not the full total — still counts as receivable.
      ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
      ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
        CHECK (status IN ('open','partial','paid','void','refunded'));
      -- Individual payments against an invoice (deposits, instalments, and the
      -- closing balance). The sum of a paid invoice's rows equals its total.
      CREATE TABLE IF NOT EXISTS invoice_payments (
        id serial PRIMARY KEY,
        invoice_id int NOT NULL,
        amount numeric(10,2) NOT NULL,
        method text NOT NULL,
        note text,
        paid_at timestamptz NOT NULL DEFAULT now()
      );
      -- An invoice line can be a service/fee with no unit SKU (Delivery, Install,
      -- ad-hoc). Those must still flow into an order, so order_items.sku must be
      -- nullable — the original NOT NULL silently broke the invoice→order bridge
      -- for any invoice containing a non-inventory line.
      ALTER TABLE order_items ALTER COLUMN sku DROP NOT NULL;
      -- Every dashboard query now asks "is this order backed by a live invoice?"
      -- per order row, as does the 24h abandoned-checkout sweep. Unindexed that
      -- is a sequential scan of invoices for each one.
      CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id) WHERE order_id IS NOT NULL;
      -- Who raised the invoice. The email is the stable identity (it's what the
      -- SALES_EMAILS gate keys off); the name is snapshotted at creation so the
      -- record still reads correctly after someone is renamed or leaves.
      -- Where the invoice came from. 'manual' (a rep in /admin/invoices), 'web'
      -- (raised automatically for a storefront checkout), 'phone', 'quote',
      -- 'salvage'. It matters operationally: a WEB invoice mirrors its order
      -- rather than driving it, and it must not shield an abandoned checkout
      -- from the 24h auto-cancel sweep the way a manual one does.
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS channel text;
      -- Which business the invoice goes out as: 'bargain_bay' (the storefront)
      -- or 'rs_solutions' (the delivery/service company). Identity only — the
      -- invoice logic is identical either way.
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS brand text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by      text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS created_by_name text;
      CREATE INDEX IF NOT EXISTS idx_invoices_created_by ON invoices(lower(created_by));
      -- Where the sale CAME FROM, as the rep taking it answered it: a walk-in,
      -- the website, a referral — and lead_by, the person who sent them. Kept
      -- on the invoice (the document the rep filled in, so reopening shows what
      -- they said and an edit corrects it) and pushed onto the bridged order,
      -- which is where the report reads from because that is where revenue is.
      -- Distinct from orders.source, which is web attribution — see
      -- LEAD_SOURCES in lib/constants.js.
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lead_source text;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lead_by     text;
      -- The matching pair on ORDERS is deliberately NOT provisioned here. It was,
      -- and that put two ALTER TABLEs against the busiest table in the app on a
      -- path every invoice READ awaits. ADD COLUMN IF NOT EXISTS still takes an
      -- ACCESS EXCLUSIVE lock when the column already exists, so on a cold start
      -- under load it queues behind an in-flight read of orders and then blocks
      -- every checkout and board query behind itself. The columns come from
      -- db/migrations/0001_baseline.sql and from ensureAttributionColumns, which the two paths that
      -- actually WRITE them await directly (see stampLead and updateInvoice).
      -- How the prices were TYPED, not how they're stored: the amounts on the
      -- invoice are always pre-tax. This only exists so reopening an invoice
      -- that was quoted tax-in shows the rep the figures they actually keyed,
      -- instead of $884.96 where they typed $1,000. It changes no arithmetic.
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT false;
      -- One row per refund event, so "already refunded $840" can always be
      -- explained. invoices.refund_total is the running sum of amount here.
      -- kind: 'items' (units came back) | 'amount' (money-only adjustment)
      -- | 'full' (the whole remaining balance). restocking_fee is money KEPT on
      -- a return (incl. its HST share) — it stays booked as revenue, so a
      -- refund total plus the fees kept is what the customer was charged.
      CREATE TABLE IF NOT EXISTS invoice_refunds (
        id             serial PRIMARY KEY,
        invoice_id     int NOT NULL,
        amount         numeric(10,2) NOT NULL,
        restocking_fee numeric(10,2) NOT NULL DEFAULT 0,
        restocking_pct numeric(5,2)  NOT NULL DEFAULT 0,
        kind           text NOT NULL,
        reason         text,
        created_by     text,
        created_at     timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_invoice_refunds_invoice ON invoice_refunds(invoice_id);

-- ---- from lib/invoices.js
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sales_rep text;

-- ---- from lib/jobs.js
CREATE TABLE IF NOT EXISTS clients (
        id serial PRIMARY KEY, name text NOT NULL UNIQUE,
        contact_email text, contact_phone text, notes text,
        notify_on_complete boolean NOT NULL DEFAULT false,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id serial PRIMARY KEY, job_number text UNIQUE,
        type text NOT NULL DEFAULT 'delivery',
        status text NOT NULL DEFAULT 'unscheduled',
        client_id int, source text NOT NULL DEFAULT 'manual', order_id int,
        customer_name text, phone text, email text,
        address text, city text, postal text,
        lat numeric(9,6), lng numeric(9,6),
        job_date date, window_start time, window_end time,
        driver_id int, seq int, notes text, fail_reason text,
        created_by text, created_by_name text,
        created_at timestamptz DEFAULT now(),
        started_at timestamptz, arrived_at timestamptz, completed_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS job_items (
        id serial PRIMARY KEY, job_id int REFERENCES jobs(id) ON DELETE CASCADE,
        description text NOT NULL, sku text, qty int NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS job_events (
        id serial PRIMARY KEY, job_id int REFERENCES jobs(id) ON DELETE CASCADE,
        event text NOT NULL, detail text, by_email text, by_name text,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_date        ON jobs(job_date);
      CREATE INDEX IF NOT EXISTS idx_jobs_driver_date ON jobs(driver_id, job_date);
      CREATE INDEX IF NOT EXISTS idx_jobs_status      ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_job_items_job    ON job_items(job_id);
      CREATE INDEX IF NOT EXISTS idx_job_events_job   ON job_events(job_id);
      CREATE TABLE IF NOT EXISTS service_tickets (
        id serial PRIMARY KEY, ticket_number text UNIQUE, client_id int,
        customer_name text, phone text, email text,
        address text, city text, postal text,
        appliance text, issue text,
        status text NOT NULL DEFAULT 'open',
        priority text NOT NULL DEFAULT 'normal',
        opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
        created_by text, created_by_name text
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON service_tickets(status);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ticket_id     int;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS shipment_type text;
      -- The allowed job types live in a CHECK constraint that was created
      -- directly on the database and is in no migration in this repo, so adding
      -- return_to_base to JOB_TYPES did nothing: every attempt to create one
      -- died on jobs_type_check, and the feature had never once been able to
      -- write a stop. Kept in step with JOB_TYPES from here on.
      --
      -- NOT VALID on purpose. It enforces the list for every new row and skips
      -- re-checking the rows already there — this table is years old, and a
      -- constraint that has to validate history is a constraint that can fail
      -- at deploy time and take ensureJobSchema, and therefore the board, with
      -- it. Wrong old rows are not what this is guarding against.
      ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
      ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
        CHECK (type IN ('delivery', 'service_call', 'pickup', 'return_to_base')) NOT VALID;
      -- A trade-in is an appliance we have to come back WITH. The credit lives
      -- on the order (order_items.kind = 'trade_in'); these two record whether
      -- the thing itself actually made it onto the van, because "we'll grab it
      -- next time" is how a unit we already paid for is never seen again.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trade_in_collected timestamptz;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS trade_in_note      text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS services      text[];
      ALTER TABLE service_tickets ADD COLUMN IF NOT EXISTS order_id int;
      -- What the person who did the job is owed for it. Set by an admin after
      -- the fact, per job, because the rate varies by what the stop actually was.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pay_amount numeric(10,2);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pay_note   text;
      -- What we CHARGE the client for the job (the pay columns are what it costs
      -- us). invoice_id is what stops the same job being billed twice.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS charge_amount numeric(10,2);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS charge_note   text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS invoice_id    int;
      -- A transfer runs FROM one address TO another — five pieces out of
      -- Mississauga into Burlington is one job with two ends, and the driver
      -- needs both. Blank means the job only has a destination.
      -- A transfer has two ends and BOTH are somewhere a driver has to be let
      -- into. The pickup end had an address and nobody to ring when the door is
      -- locked, which is the whole reason a transfer goes wrong.
      -- A second person on the same stop. Two drivers sent together are ONE van
      -- doing ONE run — not two runs — so this is a second name on the job
      -- rather than a second copy of it: the order of the day, the money and
      -- the proof of delivery all stay single. Both can see it, sign it and
      -- close it out.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS driver2_id int;
      CREATE INDEX IF NOT EXISTS idx_jobs_driver2 ON jobs(driver2_id, job_date) WHERE driver2_id IS NOT NULL;
      -- WHO we collect from, as distinct from who to ring there. A BOL names
      -- both — "Avron School and Daycare Supplies" and "AMRITA NADAR" — and the
      -- company is the one written on the building the driver is looking for.
      -- The drop end has had this all along (customer_name); the pickup end was
      -- carrying a person in a field that should hold a business.
      -- Cash the driver has to come back with that is NOT an invoice balance:
      -- a haul-away the customer pays for at the door, a client's own surcharge.
      -- It arrived as a sentence buried in a client's notes ("CUSTOMER OWERS
      -- DRIVERS $50"), printed at the same weight as a reference number, on a
      -- sheet somebody reads in a van. Money nobody can see is money nobody
      -- collects. See lib/cash-at-the-door.js for the reader that covers the
      -- stops already carrying it as prose.
      -- When the driver put the review code in front of the customer. Asking is
      -- the part we control and can measure; whether a review was left is
      -- something Google never tells us.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_asked_at timestamptz;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS collect_cash      numeric(10,2);
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS collect_cash_note text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_company text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_name  text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_phone text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_address text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_city    text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pickup_postal  text;
      CREATE INDEX IF NOT EXISTS idx_jobs_invoice ON jobs(invoice_id) WHERE invoice_id IS NOT NULL;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_in       timestamptz;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS time_out      timestamptz;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS outcome       text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parts_used    text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parts_needed  text;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signed_by     text;
      CREATE INDEX IF NOT EXISTS idx_jobs_ticket ON jobs(ticket_id) WHERE ticket_id IS NOT NULL;
      -- Proof of delivery captured by the driver's phone. It lives here rather
      -- than in the driver module because the BOARD reads it: if these were
      -- provisioned only when a driver first completed a stop, the board's own
      -- query would fail on a database no driver had used yet.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS signature_path text;
      -- Which completion produced it. A phone that finishes a stop underground
      -- replays the upload when it finds signal; the ref is what stops the
      -- second attempt writing a second set of photos.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pod_ref text;
      CREATE TABLE IF NOT EXISTS job_photos (
        id serial PRIMARY KEY,
        job_id int NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        url text, pathname text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_job_photos_job ON job_photos(job_id);
      -- The batch a photo arrived in. Photos added AFTER a stop was closed out
      -- can't share the completion's pod_ref, so they carry their own: a queue
      -- that replays a batch on a flaky connection must not double the pictures.
      -- NOT unique: one batch is several rows sharing a ref. The check is
      -- "has this batch landed at all", made before any of it is written.
      -- The signed Proof of Delivery: damage answers, the per-item table the
      -- customer initials, the explanation, and the printed name. One jsonb
      -- because it is a FORM — it is read back whole, printed whole, and its
      -- shape follows the paper it replaces, not a query.
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pod_form jsonb;
      ALTER TABLE job_photos ADD COLUMN IF NOT EXISTS ref text;
      CREATE INDEX IF NOT EXISTS idx_job_photos_ref ON job_photos(job_id, ref);
      -- Money the driver says they took at the door. NOT a payment: a payment
      -- is what the office has counted. The invoice stays open until somebody
      -- with the money in front of them confirms this row, because "delivered"
      -- and "paid" are two different facts and the phone only knows the first.
      CREATE TABLE IF NOT EXISTS job_collections (
        id serial PRIMARY KEY,
        job_id int NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        invoice_id int,
        invoice_number text,
        amount numeric(10,2) NOT NULL,
        method text NOT NULL,
        note text,
        -- The offline queue's own id for this report. A phone that finishes a
        -- stop underground re-sends the whole close-out when it finds signal,
        -- and without this the office is asked to confirm the same $500 twice.
        ref text,
        status text NOT NULL DEFAULT 'pending',
        collected_at timestamptz NOT NULL DEFAULT now(),
        by_email text, by_name text,
        settled_at timestamptz, settled_by_email text, settled_by_name text,
        settled_note text
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_job_collections_ref ON job_collections(ref) WHERE ref IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_job_collections_job ON job_collections(job_id);
      CREATE INDEX IF NOT EXISTS idx_job_collections_open ON job_collections(status) WHERE status = 'pending';

-- ---- from lib/locations.js
CREATE TABLE IF NOT EXISTS warehouse_locations (
    code       text PRIMARY KEY,
    kind       text NOT NULL,
    area       text NOT NULL,
    section    int,
    level      int,
    purpose    text,
    note       text,
    active     boolean NOT NULL DEFAULT true,
    sort       int NOT NULL DEFAULT 0,
    created_at timestamptz DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS unit_moves (
    id            bigserial PRIMARY KEY,
    sku           text NOT NULL,
    location      text,
    moved_by      text,
    moved_by_name text,
    via           text,
    note          text,
    title         text,
    moved_at      timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_unit_moves_sku ON unit_moves(sku, moved_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_unit_moves_sku_upper ON unit_moves(upper(sku));
  CREATE INDEX IF NOT EXISTS idx_unit_moves_location ON unit_moves(location);
  CREATE TABLE IF NOT EXISTS location_audits (
    id              bigserial PRIMARY KEY,
    location        text NOT NULL,
    counted_by      text,
    counted_by_name text,
    expected        int,
    confirmed       int,
    missing         jsonb,
    found           jsonb,
    counted_at      timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_location_audits_loc ON location_audits(location, counted_at DESC);
  CREATE TABLE IF NOT EXISTS warehouse_areas (
    key        text PRIMARY KEY,
    label      text NOT NULL,
    sort       int NOT NULL DEFAULT 0,
    active     boolean NOT NULL DEFAULT true,
    created_by text,
    created_at timestamptz DEFAULT now()
  );

-- ---- from lib/orders.js
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(10,2);

-- ---- from lib/orders.js
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS kind text;

-- ---- from lib/orders.js
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_total numeric(10,2) NOT NULL DEFAULT 0;
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
      ALTER TABLE orders ADD CONSTRAINT orders_status_check
        CHECK (status IN ('pending_payment','confirmed','ready','out_for_delivery','delivered','cancelled','refunded'));
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost numeric(10,2);
      ALTER TABLE order_items ADD COLUMN IF NOT EXISTS kind text;

-- ---- from lib/parts.js
CREATE TABLE IF NOT EXISTS parts (
    id          serial PRIMARY KEY,
    part_number text,
    name        text NOT NULL,
    brand       text,
    category    text,
    fits        text[],
    note        text,
    created_by  text,
    created_at  timestamptz DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_parts_number ON parts (upper(part_number))
    WHERE part_number IS NOT NULL AND part_number <> '';
  CREATE INDEX IF NOT EXISTS idx_parts_name ON parts (lower(name));
  CREATE TABLE IF NOT EXISTS part_moves (
    id        bigserial PRIMARY KEY,
    part_id   int NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    qty       int NOT NULL,
    condition text NOT NULL DEFAULT 'used',
    location  text,
    cost      numeric(10,2),
    est_value numeric(10,2),
    reason    text NOT NULL,
    ref       text,
    note      text,
    by        text,
    by_name   text,
    at        timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_part_moves_part ON part_moves(part_id, at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_part_moves_ref  ON part_moves(ref);
  CREATE TABLE IF NOT EXISTS part_requests (
    id                serial PRIMARY KEY,
    part_id           int NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    qty               int NOT NULL DEFAULT 1,
    reason            text,
    job_ref           text,
    status            text NOT NULL DEFAULT 'pending',
    requested_by      text,
    requested_by_name text,
    decided_by        text,
    decided_by_name   text,
    decided_at        timestamptz,
    picked_at         timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_part_requests_open ON part_requests(status, created_at DESC);
  ALTER TABLE salvage_units ADD COLUMN IF NOT EXISTS disposal text;

-- ---- from lib/payroll.js
CREATE TABLE IF NOT EXISTS labor_log (
    id serial PRIMARY KEY,
    worker text NOT NULL,
    work_date date NOT NULL,
    tested int DEFAULT 0,
    cleaned int DEFAULT 0,
    repaired int DEFAULT 0,
    hours numeric(6,2) DEFAULT 0,
    note text,
    source text,
    created_at timestamptz DEFAULT now()
  );

-- ---- from lib/playbook.js
CREATE TABLE IF NOT EXISTS sarah_playbook (
        id int PRIMARY KEY,
        content text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sarah_playbook_sections (
        dept text PRIMARY KEY,
        content text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now()
      );

-- ---- from lib/quotes.js
CREATE TABLE IF NOT EXISTS quotes (
        id serial PRIMARY KEY, number text UNIQUE, email text NOT NULL, name text,
        status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','converted','expired','void')),
        source text, retail_subtotal numeric(10,2), subtotal numeric(10,2),
        bundle_pct numeric(5,2) DEFAULT 0, bundle_price numeric(10,2), hst numeric(10,2),
        total numeric(10,2), cash_deal numeric(10,2), free_delivery boolean DEFAULT false,
        memo text, expires_at date, converted_invoice_id int REFERENCES invoices(id) ON DELETE SET NULL,
        created_at timestamptz DEFAULT now());
      CREATE TABLE IF NOT EXISTS quote_items (
        id serial PRIMARY KEY, quote_id int REFERENCES quotes(id) ON DELETE CASCADE,
        description text, sku text, retail numeric(10,2), amount numeric(10,2));
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS source text;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
      -- Mirrors db/migrations/0006_quote_outcomes.sql.
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_reason text;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_note   text;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_by     text;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lost_at     timestamptz;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS expired_at  timestamptz;
      CREATE INDEX IF NOT EXISTS idx_quotes_open_expiry ON quotes (expires_at) WHERE status = 'open';
      -- Where the LEAD came from, carried onto the invoice (and so onto the
      -- order, and so into the lead report) when the quote converts. Captured
      -- here rather than at conversion because that is when the lead actually
      -- arrived — by the time somebody converts, the rep who took the call may
      -- be a fortnight gone from the question. NOT the same column as source
      -- above, which records who ASSEMBLED the quote (admin | customer).
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lead_source text;
      ALTER TABLE quotes ADD COLUMN IF NOT EXISTS lead_by     text;
      CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
      CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);

-- ---- from lib/ratings.js
CREATE TABLE IF NOT EXISTS order_ratings (
    id serial PRIMARY KEY,
    order_id int REFERENCES orders(id) ON DELETE CASCADE,
    order_number text,
    rating int CHECK (rating BETWEEN 1 AND 5),
    comment text,
    created_at timestamptz DEFAULT now()
  );

-- ---- from lib/reps.js
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS sales_rep text;

-- ---- from lib/sarah-audio.js
CREATE TABLE IF NOT EXISTS sarah_audio (
        id text PRIMARY KEY,
        bytes bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );

-- ---- from lib/sarah-threads.js
CREATE TABLE IF NOT EXISTS sarah_messages (
        id serial PRIMARY KEY,
        sender text NOT NULL,
        role text NOT NULL,
        content text NOT NULL,
        provider_message_id text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sarah_messages_sender_idx ON sarah_messages (sender, id);

-- ---- from lib/settings.js
CREATE TABLE IF NOT EXISTS settings (
      key        text PRIMARY KEY,
      value      jsonb,
      updated_at timestamptz DEFAULT now()
    );

-- ---- from lib/shifts.js
-- Which van. Odometer readings from two different trucks in one column is
      -- not a mileage figure, it's noise — so a reading has to say which vehicle
      -- it came off before it can mean anything.
      CREATE TABLE IF NOT EXISTS vehicles (
        id serial PRIMARY KEY,
        name text NOT NULL,
        plate text,
        active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      -- WHO PAYS FOR THE FUEL, and it is a property of the truck, not of the
      -- fill. The 20ft box truck comes from a carrier who bills fortnightly for
      -- the truck AND its diesel; our own pickups are fuelled by the driver, who
      -- gets e-transferred for it. Those are different kinds of money and the
      -- P&L has to treat them differently or it counts the same diesel twice —
      -- once as a fill and again inside the carrier's invoice.
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_paid_by text NOT NULL DEFAULT 'us';
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS carrier_name text;
      -- What the truck costs for a day it goes out, whoever is driving it. The
      -- box truck is $60. Charged once per van per day, not once per shift: a
      -- two-man day on one truck is one truck.
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS day_rate numeric(10,2);
      -- The tracker bolted to the truck, by its id in PAJ's portal. A van with
      -- one reports its own position whether or not anybody's phone is awake,
      -- which is the half the driver app can never do.
      ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tracker_device_id text;
      -- One device, one van. Without this two trucks can claim the same tracker
      -- and the board draws one dot twice, in two names, with nothing to say
      -- which of them is actually out.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_tracker
        ON vehicles(tracker_device_id) WHERE tracker_device_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS driver_shifts (
        id serial PRIMARY KEY,
        user_id int NOT NULL,
        -- Not everybody on a shift is DRIVING. A second crew member rides with
        -- somebody else all day: on the clock, not responsible for a van, and
        -- unable to read an odometer from the passenger seat. Whatever they
        -- typed would be a guess, and a guess in this column corrupts every
        -- mileage figure built on it.
        driving boolean NOT NULL DEFAULT true,
        riding_with int,
        vehicle_id int,
        started_at timestamptz NOT NULL,
        ended_at   timestamptz,
        start_km int,
        end_km   int,
        start_lat numeric(9,6), start_lng numeric(9,6),
        end_lat   numeric(9,6), end_lng   numeric(9,6),
        note text,
        ref text
      );
      CREATE INDEX IF NOT EXISTS idx_driver_shifts_user ON driver_shifts(user_id, started_at DESC);
      -- What an hour of this person costs. Ruban is $25 (it is what the carrier
      -- bills for him), Kowsi is $20 and we pay him directly.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate numeric(8,2);
      -- When we last asked "are you still working?". Stamped so a driver gets
      -- the question once an evening and not once an hour.
      ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS nudged_at timestamptz;
      -- Who corrected this shift and when. A shift the office has retyped is a
      -- different kind of record from one the driver's taps produced, and the
      -- person reading the hours is entitled to know which they are looking at.
      ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS edited_at timestamptz;
      ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS edited_by text;
      ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS driving     boolean NOT NULL DEFAULT true;
      ALTER TABLE driver_shifts ADD COLUMN IF NOT EXISTS riding_with int;
      -- One open shift per driver, enforced where it cannot be argued with: a
      -- phone that replays "start shift" off the offline queue must not open a
      -- second one and quietly double somebody's hours.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_shift_open
        ON driver_shifts(user_id) WHERE ended_at IS NULL;
      -- The fuel side of dispatch_expenses. The row already existed for gas the
      -- office typed in; these are what a driver filling up on the road adds to
      -- it, and what turns a pile of receipts into a mileage figure.
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS litres       numeric(8,2);
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS odometer_km  int;
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS vehicle_id   int;
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS shift_id     int;
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS receipt_path text;
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS receipt_url  text;
      ALTER TABLE dispatch_expenses ADD COLUMN IF NOT EXISTS ref          text;
      CREATE INDEX IF NOT EXISTS idx_dispatch_expenses_ref ON dispatch_expenses(ref) WHERE ref IS NOT NULL;

-- ---- from lib/stock-reconcile.js
CREATE TABLE IF NOT EXISTS stock_fill_requests (
        id serial PRIMARY KEY,
        sku text NOT NULL,
        invoice text,
        vendor text,
        lot text,
        line jsonb NOT NULL,
        status text NOT NULL DEFAULT 'pending',   -- pending | approved | rejected | refused
        note text,
        requested_by text,
        requested_at timestamptz NOT NULL DEFAULT now(),
        decided_by text,
        decided_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS idx_stock_fill_pending ON stock_fill_requests (status) WHERE status = 'pending';
      -- One open question per unit: asking again replaces the earlier one.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_fill_one_pending ON stock_fill_requests (upper(sku)) WHERE status = 'pending';

-- ---- from lib/unit-photos.js
CREATE TABLE IF NOT EXISTS unit_photos (
        id         serial PRIMARY KEY,
        sku        text NOT NULL,
        path       text NOT NULL,
        url        text NOT NULL,
        position   int NOT NULL DEFAULT 0,
        created_by text,
        created_at timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_unit_photos_sku ON unit_photos(sku, position, id);
