-- Dinapoli Pizza schema (SQLite). See ../../../dinapoli_schema.mmd for the ER diagram.

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE CHECK (number BETWEEN 1 AND 9),
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'busy'))
);

-- Identification only: no auth, no login, just a name to attribute an order
-- to. Soft-deleted via is_active rather than removed, so past orders keep a
-- valid employee_id and historical reports stay accurate.
CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  picture_url TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  key  TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id            INTEGER NOT NULL REFERENCES categories(id),
  key                    TEXT NOT NULL,
  name                   TEXT NOT NULL,
  description            TEXT,
  price                  INTEGER,
  is_available           INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  requires_pizza_flavor  INTEGER NOT NULL DEFAULT 0 CHECK (requires_pizza_flavor IN (0, 1)),
  UNIQUE (category_id, key)
);

CREATE TABLE IF NOT EXISTS product_sizes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  name       TEXT NOT NULL,
  price      INTEGER NOT NULL,
  UNIQUE (product_id, key)
);

CREATE TABLE IF NOT EXISTS product_options (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  name       TEXT NOT NULL,
  UNIQUE (product_id, key)
);

CREATE TABLE IF NOT EXISTS pizza_groups (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  key  TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pizza_sizes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  slices      INTEGER NOT NULL,
  max_flavors INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pizza_group_sizes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES pizza_groups(id),
  size_id  INTEGER NOT NULL REFERENCES pizza_sizes(id),
  price    INTEGER,
  UNIQUE (group_id, size_id)
);

CREATE TABLE IF NOT EXISTS pizza_flavors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  description  TEXT,
  extra_cost   INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1))
);

CREATE TABLE IF NOT EXISTS pizza_group_flavors (
  group_id  INTEGER NOT NULL REFERENCES pizza_groups(id),
  flavor_id INTEGER NOT NULL REFERENCES pizza_flavors(id),
  PRIMARY KEY (group_id, flavor_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_type     TEXT NOT NULL CHECK (order_type IN ('dine_in', 'takeaway', 'delivery')),
  status         TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PRINTING', 'ACTIVE', 'COMPLETED')),
  employee_id    INTEGER REFERENCES employees(id),
  table_number   INTEGER CHECK (table_number BETWEEN 1 AND 9),
  customer_name  TEXT,
  phone          TEXT,
  address        TEXT,
  notes          TEXT,
  total          INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at   TEXT,
  print_attempts INTEGER NOT NULL DEFAULT 0
);


-- printed_at is NULL until the queue worker includes this item in a kitchen
-- ticket. Items added to an order that's already ACTIVE (see
-- orderService.addOrderItems) come in with it NULL too, and flip the order's
-- status back to PENDING so the same PENDING/PRINTING queue pass that
-- printed the original ticket picks it up again - the worker tells "first
-- ticket" from "addition" apart by whether any of the order's items already
-- have printed_at set (queueService.processOrder), printing an addendum
-- (new items only) in the latter case instead of the whole order again.
CREATE TABLE IF NOT EXISTS order_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_type         TEXT NOT NULL CHECK (item_type IN ('pizza', 'product')),
  product_id        INTEGER REFERENCES products(id),
  product_size_id   INTEGER REFERENCES product_sizes(id),
  product_option_id INTEGER REFERENCES product_options(id),
  pizza_group_id    INTEGER REFERENCES pizza_groups(id),
  pizza_size_id     INTEGER REFERENCES pizza_sizes(id),
  pizza_flavor_id   INTEGER REFERENCES pizza_flavors(id),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_price        INTEGER NOT NULL,
  notes             TEXT,
  printed_at        TEXT
);

-- portion is this flavor's share of the pizza, as a percent (1-100). Across
-- all of one order_item's rows here, portion must sum to exactly 100 -
-- enforced in orderService.resolvePizzaItem, not by the DB (SQLite can't
-- check a cross-row sum in a CHECK constraint).
CREATE TABLE IF NOT EXISTS order_item_flavors (
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  flavor_id     INTEGER NOT NULL REFERENCES pizza_flavors(id),
  portion       INTEGER NOT NULL DEFAULT 100 CHECK (portion BETWEEN 1 AND 100),
  PRIMARY KEY (order_item_id, flavor_id)
);

-- One row per method used to settle an order, written once at completion -
-- this is the ONLY place tip/delivery fee/discount are ever recorded (there's
-- no way to declare them before a payment method is chosen; Order.tip/
-- deliveryFee/discount are always 0 before this and derived by summing these
-- rows afterward, see orderService.getOrderById). A normal order has exactly
-- one row here; a mixed payment (e.g. part cash, part card) has several,
-- whose amounts must sum to (total + the payments' own declared tip/delivery
-- fee totals) - enforced in orderService.resolvePayments, not by the DB.
-- `amount` is always the GROSS charge for that split, before its own
-- discount slice - discount is never subtracted from it, so the full
-- pre-discount price is always on record; the actual cash collected for a
-- split is derived as (amount - discount) whenever needed, never stored
-- directly. tip_amount, delivery_fee, and discount are each a slice of
-- `amount` (e.g. $30 owed + a $5 tip charged to the card, cash covering a
-- separate $20: that row is amount=35, tip_amount=5) - this lets End-of-Day
-- exclude tips and discounts (while keeping delivery fees, where relevant)
-- from sales per payment method exactly instead of guessing via a
-- proportional split.
CREATE TABLE IF NOT EXISTS order_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method       TEXT NOT NULL CHECK (method IN ('cash', 'card', 'transfer')),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  tip_amount   INTEGER NOT NULL DEFAULT 0 CHECK (tip_amount >= 0 AND tip_amount <= amount),
  delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0 AND delivery_fee <= amount),
  discount     INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= amount),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One saved artifact per (order, kind): content is deterministic from the
-- order row, so re-generating it (e.g. a queue retry) upserts in place
-- instead of piling up duplicate rows. Reprinting re-sends this saved copy.
CREATE TABLE IF NOT EXISTS print_jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('kitchen_ticket', 'bill')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (order_id, kind)
);

-- Single configurable row: the default cash the register opens with. Used
-- only to seed a new cash_flow period (see below) - not touched afterward.
CREATE TABLE IF NOT EXISTS cash_register_settings (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  default_opening_cash  INTEGER NOT NULL DEFAULT 0
);

-- One row per register period (one per business day). A fresh period opens
-- automatically the moment the latest row's date isn't today anymore
-- (cashFlowService.getCurrentCashFlow) - this bookkeeping rotation is not
-- the End-of-Day Closing itself (see closing_reports below), which stays a
-- manual staff action. Old rows are never deleted or overwritten; the
-- "current" period is simply the most recently created row (highest id).
CREATE TABLE IF NOT EXISTS cash_flow (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  date             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d', 'now')),
  cash_in_register INTEGER NOT NULL,
  expenses         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS cash_expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_flow_id  INTEGER NOT NULL REFERENCES cash_flow(id) ON DELETE CASCADE,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  justification TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A snapshot of one business day's sales, generated and printed by an
-- explicit staff action (POST /api/end-of-day/close), never automatically.
-- Recomputed from `orders`/`cash_flow` at generation time, then frozen here
-- (plus the exact printed text, for reprinting) so history survives even if
-- later corrections change the underlying orders. Nothing stops closing the
-- same day twice (e.g. a reprint after a paper jam) - every call appends a
-- new row rather than overwriting, same append-only spirit as cash_flow.
CREATE TABLE IF NOT EXISTS closing_reports (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  date                   TEXT NOT NULL,
  order_count            INTEGER NOT NULL,
  delivery_sales         INTEGER NOT NULL,
  dine_in_takeaway_sales INTEGER NOT NULL,
  cash_sales             INTEGER NOT NULL,
  card_sales             INTEGER NOT NULL,
  transfer_sales         INTEGER NOT NULL,
  total_sales            INTEGER NOT NULL,
  total_expenses         INTEGER NOT NULL,
  content                TEXT NOT NULL,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_table_number ON orders(table_number);
CREATE INDEX IF NOT EXISTS idx_orders_employee_id ON orders(employee_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_order_id ON order_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_cash_flow_id ON cash_expenses(cash_flow_id);
