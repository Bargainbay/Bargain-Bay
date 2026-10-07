-- Public booking requests on rssolutions.ca: a service call to be booked, or a
-- moving quote to be priced. One row per request.
--
-- A request is NOT a ticket and NOT a job. Anybody on the internet can submit
-- one, and a ticket lands in the service queue and a job on a driver's board;
-- a person at the dispatch desk decides which requests become either. The
-- ticket it was turned into is remembered in ticket_id.
--
-- `details` holds what only one kind asks for (appliance and fault for a
-- service call; both ends, stairs and bulky items for a move). A jsonb because
-- it is a FORM — read back whole, shown whole — and its shape follows the page.
CREATE TABLE IF NOT EXISTS booking_requests (
  id             serial PRIMARY KEY,
  ref            text UNIQUE,
  kind           text NOT NULL CHECK (kind IN ('service', 'move')),
  status         text NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'contacted', 'converted', 'closed')),
  name           text NOT NULL,
  email          text NOT NULL,
  phone          text NOT NULL,
  address        text,
  city           text,
  postal         text,
  preferred_date date,
  preferred_window text,
  note           text,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  ticket_id      int,
  handled_by     text,
  ip             text,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_requests_status ON booking_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_requests_ip     ON booking_requests(ip, created_at);
