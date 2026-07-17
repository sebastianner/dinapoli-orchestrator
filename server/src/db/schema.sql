-- Dinapoli Pizza schema (SQLite). See ../../../dinapoli_schema.mmd for the ER diagram.

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  number INTEGER NOT NULL UNIQUE CHECK (number BETWEEN 1 AND 9),
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'busy'))
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
  payment_method TEXT CHECK (payment_method IN ('cash', 'card', 'transfer')),
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
  notes             TEXT
);

CREATE TABLE IF NOT EXISTS order_item_flavors (
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  flavor_id     INTEGER NOT NULL REFERENCES pizza_flavors(id),
  PRIMARY KEY (order_item_id, flavor_id)
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

-- One row per register period. A new period is only ever opened by an
-- explicit staff action (the future End-of-Day Closing module's reset
-- endpoint) - never rotated automatically by calendar date. Old rows are
-- never deleted or overwritten; the "current" period is simply the most
-- recently created row (highest id).
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

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_table_number ON orders(table_number);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_cash_flow_id ON cash_expenses(cash_flow_id);
