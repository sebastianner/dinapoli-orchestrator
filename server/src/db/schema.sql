-- Dinapoli Pizza schema (SQLite). See ../../../dinapoli_schema.mmd for the ER diagram.

-- Numbered 1..N with no gaps, N being however many tables the restaurant
-- currently has - tableService.increaseTableCount/decreaseTableCount only
-- ever add/remove the highest number, so this invariant holds without a
-- static upper bound (see migrate.ts's widenTableNumberBounds for the
-- one-time migration off the old hardcoded 1-9 CHECK).
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE CHECK (number > 0),
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'busy'))
);

-- Soft-deleted via is_active rather than removed, so past orders keep a
-- valid employee_id and historical reports stay accurate. Only 'admin' rows
-- ever carry a password_hash - 'staff' log in by picking their name, no
-- password (see authService.login). password_hash is a bcrypt hash, never
-- the plaintext password - see utils/password.ts.
CREATE TABLE IF NOT EXISTS employees (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  picture_url   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'admin')),
  password_hash TEXT
);

-- One row per issued refresh token, so a token can be revoked/rotated
-- individually (e.g. on logout or reuse) without invalidating every other
-- session for that employee. token_hash is a sha256 of the raw token that's
-- actually set as the refresh_token cookie - only the hash is ever stored,
-- same "never store the usable secret" reasoning as password_hash above.
-- Rows are never deleted, only marked revoked_at, so a stolen/reused token
-- can be told apart from one that simply never existed.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS cities (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  department TEXT,
  country    TEXT NOT NULL DEFAULT 'Colombia'
);

-- One row per delivery-fee zone. delivery_fee is only ever a *suggestion*: it
-- rides along on every address the frontend fetches so checkout can pre-fill
-- the fee, but nothing applies it server-side - staff confirm or adjust it at
-- completion like any other payments[].deliveryFee.
CREATE TABLE IF NOT EXISTS neighborhoods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  city_id       INTEGER NOT NULL REFERENCES cities(id),
  delivery_fee  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (city_id, name)
);

-- No auth required to create/update (see routes/customers.ts) - this is
-- staff entering a walk-in/calling customer's details, not a public-facing
-- account system. Only deleting a customer outright is admin-gated.
CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A customer may have zero or more saved addresses. The geo/place columns
-- (latitude/longitude/google_place_id/formatted_address) are nullable and
-- unused for now - no maps/geocoding integration in this pass, just reserved
-- for one later.
CREATE TABLE IF NOT EXISTS customer_addresses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id       INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  street_address    TEXT NOT NULL,
  -- Free-text second line (e.g. "casa 5, interior 2"), independent of
  -- property_type - unlike apartment_number/tower/building_name, which only
  -- apply to APARTMENT.
  address_line_2    TEXT,
  property_type     TEXT NOT NULL CHECK (property_type IN ('HOUSE', 'APARTMENT', 'OFFICE', 'BUILDING', 'OTHER')),
  neighborhood_id   INTEGER NOT NULL REFERENCES neighborhoods(id),
  apartment_number  TEXT,
  tower             TEXT,
  building_name     TEXT,
  reference         TEXT,
  latitude          REAL,
  longitude         REAL,
  google_place_id   TEXT,
  formatted_address TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- External-content FTS5 table (tokenize='trigram' for typo/substring-tolerant
-- matching) over customers.name/phone, used by customerService.searchCustomers
-- for the order-form autocomplete. "External content" means the FTS index
-- stores no data of its own - content_rowid ties each row back to customers.id
-- - so it MUST be kept in sync via the triggers below rather than written to
-- directly. This is the first FTS5 use in this codebase, chosen over
-- spellfix1 (not vendored anywhere in this repo/environment, would need a
-- per-platform compiled binary) since FTS5 is already compiled into the
-- installed better-sqlite3 with no extra setup.
CREATE VIRTUAL TABLE IF NOT EXISTS customers_fts USING fts5(
  name,
  phone,
  content='customers',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS customers_fts_insert AFTER INSERT ON customers BEGIN
  INSERT INTO customers_fts (rowid, name, phone) VALUES (new.id, new.name, new.phone);
END;

CREATE TRIGGER IF NOT EXISTS customers_fts_delete AFTER DELETE ON customers BEGIN
  INSERT INTO customers_fts (customers_fts, rowid, name, phone) VALUES ('delete', old.id, old.name, old.phone);
END;

CREATE TRIGGER IF NOT EXISTS customers_fts_update AFTER UPDATE ON customers BEGIN
  INSERT INTO customers_fts (customers_fts, rowid, name, phone) VALUES ('delete', old.id, old.name, old.phone);
  INSERT INTO customers_fts (rowid, name, phone) VALUES (new.id, new.name, new.phone);
END;

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

-- Shared/reusable across products, same spirit as pizza_flavors below - e.g.
-- "Coca-Cola" is one row that both Gaseosa 1.5L and Gaseosa Personal offer,
-- rather than being duplicated per product like product_options used to be.
CREATE TABLE IF NOT EXISTS drink_flavors (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  key  TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

-- Which products offer which drink flavors (0 to many) - a product with no
-- rows here (e.g. Coca-Cola 3L) just doesn't show a flavor picker at all.
CREATE TABLE IF NOT EXISTS product_drink_flavors (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  flavor_id  INTEGER NOT NULL REFERENCES drink_flavors(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, flavor_id)
);

-- Same external-content trigram FTS5 setup as customers_fts above, over
-- products.name/description - powers menuService.searchProducts (the
-- /menu/todos "buscar" bar). See customers_fts's comment for why trigram
-- over spellfix1.
CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
  name,
  description,
  content='products',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS products_fts_insert AFTER INSERT ON products BEGIN
  INSERT INTO products_fts (rowid, name, description) VALUES (new.id, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS products_fts_delete AFTER DELETE ON products BEGIN
  INSERT INTO products_fts (products_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
END;

CREATE TRIGGER IF NOT EXISTS products_fts_update AFTER UPDATE ON products BEGIN
  INSERT INTO products_fts (products_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
  INSERT INTO products_fts (rowid, name, description) VALUES (new.id, new.name, new.description);
END;

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

-- Same external-content trigram FTS5 setup as products_fts above, over
-- pizza_flavors.name/description - powers menuService.searchPizzaFlavors
-- (the pizza size picker's "buscar sabor" bar).
CREATE VIRTUAL TABLE IF NOT EXISTS pizza_flavors_fts USING fts5(
  name,
  description,
  content='pizza_flavors',
  content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS pizza_flavors_fts_insert AFTER INSERT ON pizza_flavors BEGIN
  INSERT INTO pizza_flavors_fts (rowid, name, description) VALUES (new.id, new.name, new.description);
END;

CREATE TRIGGER IF NOT EXISTS pizza_flavors_fts_delete AFTER DELETE ON pizza_flavors BEGIN
  INSERT INTO pizza_flavors_fts (pizza_flavors_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
END;

CREATE TRIGGER IF NOT EXISTS pizza_flavors_fts_update AFTER UPDATE ON pizza_flavors BEGIN
  INSERT INTO pizza_flavors_fts (pizza_flavors_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
  INSERT INTO pizza_flavors_fts (rowid, name, description) VALUES (new.id, new.name, new.description);
END;

CREATE TABLE IF NOT EXISTS orders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_type          TEXT NOT NULL CHECK (order_type IN ('dine_in', 'takeaway', 'delivery')),
  status              TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PRINTING', 'ACTIVE', 'COMPLETED')),
  employee_id         INTEGER REFERENCES employees(id),
  -- No upper bound - restaurant_tables.number has none either, since the
  -- table count is admin-adjustable at runtime (see tableService).
  table_number        INTEGER CHECK (table_number IS NULL OR table_number > 0),
  -- Nullable - required by validation (customerService/orderService), not the
  -- DB, same as table_number above: dine_in never sets these, takeaway
  -- requires customer_id, delivery requires both. customer_name/phone/address
  -- used to be plain columns here; now derived via JOIN in orderService
  -- .getOrderById, under the same field names, so printerService/
  -- billingService read them unchanged.
  customer_id         INTEGER REFERENCES customers(id),
  customer_address_id INTEGER REFERENCES customer_addresses(id),
  notes               TEXT,
  -- Legacy - a single promo type could represent, back when an order could
  -- only carry one promo. Orders placed since order_promos was introduced
  -- leave this NULL and record their promo(s) there instead (an order can
  -- now carry several); kept only so older orders' promo_type is still
  -- readable. Set once at creation, never changed.
  promo_type          TEXT CHECK (promo_type IS NULL OR promo_type IN ('duo', 'pizza_xl')),
  -- "Delivery #N of the day" as printed on the kitchen comanda. Assigned once,
  -- inside the creating transaction, rather than counted live at print time:
  -- counting live meant deleting an earlier delivery order silently renumbered
  -- every later one, so a reprint no longer matched the ticket the kitchen
  -- already had. NULL for non-delivery orders (and for delivery rows that
  -- predate this column - see printerService.deliveryOrderNumberOfDay, which
  -- falls back to the old live count for those).
  delivery_day_number INTEGER,
  -- Items only - excludes tip/deliveryFee/discount (those live in order_payments,
  -- see grandTotal for the "everything included" figure this deliberately isn't).
  total               INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at        TEXT,
  print_attempts      INTEGER NOT NULL DEFAULT 0
);


-- One row per promo instance placed on the order - an order can carry
-- several at once (e.g. a 'duo' AND a 'pizza_xl' in the same cart), which is
-- what orders.promo_type (a single nullable value) couldn't represent. New
-- orders use this table instead; promo_type is kept only for orders placed
-- before this table existed. `sequence` is this promo's 0-based position
-- within the order - order_items.promo_group_id points at the specific row
-- here an item belongs to, and the client tags items with that same index
-- (see orderService.validatePromoItems/applyPromoPricing).
CREATE TABLE IF NOT EXISTS order_promos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sequence   INTEGER NOT NULL,
  promo_type TEXT NOT NULL CHECK (promo_type IN ('duo', 'pizza_xl')),
  UNIQUE (order_id, sequence)
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
  drink_flavor_id   INTEGER REFERENCES drink_flavors(id),
  pizza_group_id    INTEGER REFERENCES pizza_groups(id),
  pizza_size_id     INTEGER REFERENCES pizza_sizes(id),
  pizza_flavor_id   INTEGER REFERENCES pizza_flavors(id),
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  unit_price        INTEGER NOT NULL,
  notes             TEXT,
  -- Whether this row is one of the items the order's promo is made of, as
  -- opposed to a normally-priced item sharing the same order (promos and
  -- extra items can be mixed - see orderService.applyPromoPricing). Recorded
  -- because it cannot be inferred afterwards: a promo item's unit_price is
  -- the flat promo price, 0, or a soda surcharge, none of which are
  -- distinguishable from a regular item's price. printerService.promoBasePrice
  -- used to guess (max price / first pizza) and printed the wrong figure on
  -- the kitchen ticket whenever a pricier extra item shared the order.
  -- Always 0 for items added later via addOrderItems - a promo is fixed at
  -- creation (see orders.promo_type).
  promo_item        INTEGER NOT NULL DEFAULT 0 CHECK (promo_item IN (0, 1)),
  -- Which of the order's (possibly several) promo instances this item
  -- belongs to, or NULL for a normally-priced item. References order_promos,
  -- not orders.promo_type directly, since an order can carry more than one
  -- promo (see order_promos above). Always NULL for items added later via
  -- addOrderItems, same as promo_item.
  promo_group_id    INTEGER REFERENCES order_promos(id),
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
-- `gross_amount` is always the GROSS charge for that split, before its own
-- discount slice - discount is never subtracted from it, so the full
-- pre-discount price is always on record; the actual cash collected for a
-- split is derived as (gross_amount - discount) whenever needed, never stored
-- directly. tip_amount, delivery_fee, and discount are each a slice of
-- `gross_amount` (e.g. $30 owed + a $5 tip charged to the card, cash covering
-- a separate $20: that row is gross_amount=35, tip_amount=5) - this lets End-of-Day
-- exclude tips and discounts (while keeping delivery fees, where relevant)
-- from sales per payment method exactly instead of guessing via a
-- proportional split.
-- gross_amount is the FULL amount charged via this method - items + tip + delivery
-- fee, before this split's own discount - unlike orders.total, which is items only.
-- Named "gross" specifically so it can never be confused with orders.total at a
-- glance; see Order.grandTotal (= total + tip + deliveryFee) for the order-level
-- equivalent of this same "everything included" concept. net_amount is the
-- products-only slice of gross_amount (tip/delivery fee excluded, discount
-- deliberately NOT subtracted here either - see discount's own comment below) -
-- SUM(net_amount) across an order's splits always equals orders.total exactly,
-- server-computed at insert time, never client-supplied.
CREATE TABLE IF NOT EXISTS order_payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method       TEXT NOT NULL CHECK (method IN ('cash', 'card', 'transfer', 'rappi')),
  gross_amount INTEGER NOT NULL CHECK (gross_amount > 0),
  tip_amount   INTEGER NOT NULL DEFAULT 0 CHECK (tip_amount >= 0 AND tip_amount <= gross_amount),
  delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0 AND delivery_fee <= gross_amount),
  net_amount   INTEGER NOT NULL CHECK (net_amount >= 0),
  -- Discounts are applied to products, not tip/delivery fee - so this is bounded
  -- by net_amount (the products slice), not the looser gross_amount.
  discount     INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= net_amount),
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

-- Admin-editable (see routes/promos.ts) - orderService.applyPromoPricing
-- reads these live at order-creation time rather than using hardcoded
-- constants, so a price change takes effect on the next order immediately.
-- Already-placed orders are unaffected - their items' unit_price was
-- snapshotted at creation time, same as any other price in this app (see
-- printerService.describePromoType, which derives a kitchen ticket's promo
-- label from that snapshot rather than the current setting, for exactly
-- this reason). soda_surcharge only applies to 'pizza_xl' - 0/unused for 'duo'.
CREATE TABLE IF NOT EXISTS promo_settings (
  promo_type     TEXT PRIMARY KEY CHECK (promo_type IN ('duo', 'pizza_xl')),
  price          INTEGER NOT NULL CHECK (price > 0),
  soda_surcharge INTEGER NOT NULL DEFAULT 0 CHECK (soda_surcharge >= 0)
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
  rappi_sales            INTEGER NOT NULL DEFAULT 0,
  total_sales            INTEGER NOT NULL,
  tips                   INTEGER NOT NULL DEFAULT 0,
  discounts              INTEGER NOT NULL DEFAULT 0,
  items_sold             INTEGER NOT NULL DEFAULT 0,
  customers_served       INTEGER NOT NULL DEFAULT 0,
  delivery_order_count   INTEGER NOT NULL DEFAULT 0,
  dine_in_order_count    INTEGER NOT NULL DEFAULT 0,
  takeaway_order_count   INTEGER NOT NULL DEFAULT 0,
  total_expenses         INTEGER NOT NULL,
  cash_in_register       INTEGER NOT NULL DEFAULT 0,
  expenses_detail        TEXT NOT NULL DEFAULT '[]',
  content                TEXT NOT NULL,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_table_number ON orders(table_number);
CREATE INDEX IF NOT EXISTS idx_orders_employee_id ON orders(employee_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
-- Analytics date-range filtering (analyticsService) scans this on every query.
CREATE INDEX IF NOT EXISTS idx_orders_completed_at ON orders(completed_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
-- Product/category revenue rollups (analyticsService.getProducts) group by this.
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_payments_order_id ON order_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_cash_flow_id ON cash_expenses(cash_flow_id);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer_id ON customer_addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_addresses_neighborhood_id ON customer_addresses(neighborhood_id);
CREATE INDEX IF NOT EXISTS idx_neighborhoods_city_id ON neighborhoods(city_id);
