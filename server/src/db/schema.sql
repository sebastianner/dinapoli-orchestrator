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
  name       TEXT NOT NULL,
  UNIQUE (product_id, name)
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

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_table_number ON orders(table_number);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
