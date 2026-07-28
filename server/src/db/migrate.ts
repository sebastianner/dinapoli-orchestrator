import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TABLES = [
  "closing_reports",
  "cash_expenses",
  "cash_flow",
  "cash_register_settings",
  "promo_settings",
  "print_jobs",
  "order_item_flavors",
  "order_items",
  "order_payments",
  "orders",
  "customers_fts",
  "products_fts",
  "customer_addresses",
  "customers",
  "neighborhoods",
  "cities",
  "employees",
  "refresh_tokens",
  "pizza_group_flavors",
  "pizza_flavors",
  "pizza_group_sizes",
  "pizza_sizes",
  "pizza_groups",
  "product_options",
  "product_sizes",
  "products",
  "categories",
  "restaurant_tables",
];

function reset(): void {
  db.pragma("foreign_keys = OFF");
  const dropAll = db.transaction(() => {
    for (const table of TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table};`);
    }
  });
  dropAll();
  db.pragma("foreign_keys = ON");
}

function migrate(): void {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  ensureColumn(
    "order_item_flavors",
    "portion",
    "INTEGER NOT NULL DEFAULT 100 CHECK (portion BETWEEN 1 AND 100)",
  );
  ensureColumn(
    "order_payments",
    "delivery_fee",
    "INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0 AND delivery_fee <= amount)",
  );
  ensureColumn(
    "order_payments",
    "discount",
    "INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= amount)",
  );
  ensureColumn("closing_reports", "tips", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("closing_reports", "discounts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("closing_reports", "items_sold", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(
    "closing_reports",
    "customers_served",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    "closing_reports",
    "delivery_order_count",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    "closing_reports",
    "dine_in_order_count",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    "closing_reports",
    "takeaway_order_count",
    "INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(
    "orders",
    "promo_type",
    "TEXT CHECK (promo_type IS NULL OR promo_type IN ('duo', 'pizza_xl'))",
  );
  ensureColumn(
    "employees",
    "role",
    "TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'admin'))",
  );
  ensureColumn("employees", "password_hash", "TEXT");
  // customer_name/phone/address used to be free-text columns directly on
  // orders; replaced by a customer_id/customer_address_id FK pair into the
  // new customers/customer_addresses tables (see orderService.getOrderById
  // for how customerName/phone/address are now derived via JOIN instead).
  // No backfill - dropped outright rather than migrated, since there's no
  // production data yet to preserve.
  ensureColumn("orders", "customer_id", "INTEGER REFERENCES customers(id)");
  ensureColumn(
    "orders",
    "customer_address_id",
    "INTEGER REFERENCES customer_addresses(id)",
  );
  ensureColumn("customer_addresses", "address_line_2", "TEXT");
  dropColumnIfExists("orders", "customer_name");
  dropColumnIfExists("orders", "phone");
  dropColumnIfExists("orders", "address");
  // Was just "amount" - renamed to make it unmistakable that this is the GROSS
  // total (items + tip + delivery fee) charged via this method, unlike
  // orders.total (items only). SQLite 3.25+ rewrites the CHECK constraints
  // added above (they reference "amount") to the new name automatically.
  renameColumnIfExists("order_payments", "amount", "gross_amount");
  addNetAmountToOrderPayments();
  dropColumnIfExists("orders", "payment_method");
  dropColumnIfExists("orders", "tip");
  dropColumnIfExists("orders", "delivery_fee");
  // Tip/delivery fee/discount are only ever declared at completion now (see
  // order_payments) - this short-lived table held the pre-checkout-editable
  // version of them and is no longer used.
  db.exec("DROP TABLE IF EXISTS order_settlement");
  seedDefaultPromoSettings();
  backfillProductsFts();
  widenTableNumberBounds();
}

/**
 * restaurant_tables.number and orders.table_number both used to be hard-CHECKed
 * to 1-9 (the restaurant was assumed fixed-size). Now that admins can grow/
 * shrink the table count at runtime (tableService.setTableCount), a static
 * upper bound can't express that, so both CHECKs are widened to just "> 0".
 * SQLite can't ALTER a CHECK constraint in place - same rebuild pattern as
 * addNetAmountToOrderPayments. Guarded by inspecting each table's stored SQL
 * rather than a column-existence check (the columns already exist; only the
 * CHECK text changes), so this is a no-op once already migrated.
 */
function widenTableNumberBounds(): void {
  const oldBound = "BETWEEN 1 AND 9";

  const tablesSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'restaurant_tables'").get() as
    | { sql: string }
    | undefined;
  if (tablesSql?.sql.includes(oldBound)) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE restaurant_tables_new (
          id     INTEGER PRIMARY KEY AUTOINCREMENT,
          number INTEGER NOT NULL UNIQUE CHECK (number > 0),
          status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'busy'))
        );
      `);
      db.exec("INSERT INTO restaurant_tables_new (id, number, status) SELECT id, number, status FROM restaurant_tables;");
      db.exec("DROP TABLE restaurant_tables;");
      db.exec("ALTER TABLE restaurant_tables_new RENAME TO restaurant_tables;");
    })();
    db.pragma("foreign_keys = ON");
  }

  const ordersSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'").get() as { sql: string } | undefined;
  if (ordersSql?.sql.includes(oldBound)) {
    db.pragma("foreign_keys = OFF");
    db.transaction(() => {
      db.exec(`
        CREATE TABLE orders_new (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          order_type          TEXT NOT NULL CHECK (order_type IN ('dine_in', 'takeaway', 'delivery')),
          status              TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PRINTING', 'ACTIVE', 'COMPLETED')),
          employee_id         INTEGER REFERENCES employees(id),
          table_number        INTEGER CHECK (table_number IS NULL OR table_number > 0),
          customer_id         INTEGER REFERENCES customers(id),
          customer_address_id INTEGER REFERENCES customer_addresses(id),
          notes               TEXT,
          promo_type          TEXT CHECK (promo_type IS NULL OR promo_type IN ('duo', 'pizza_xl')),
          total               INTEGER NOT NULL DEFAULT 0,
          created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          completed_at        TEXT,
          print_attempts      INTEGER NOT NULL DEFAULT 0
        );
      `);
      db.exec(`
        INSERT INTO orders_new (id, order_type, status, employee_id, table_number, customer_id, customer_address_id, notes, promo_type, total, created_at, completed_at, print_attempts)
        SELECT id, order_type, status, employee_id, table_number, customer_id, customer_address_id, notes, promo_type, total, created_at, completed_at, print_attempts
        FROM orders;
      `);
      db.exec("DROP TABLE orders;");
      db.exec("ALTER TABLE orders_new RENAME TO orders;");
      db.exec("CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);");
      db.exec("CREATE INDEX IF NOT EXISTS idx_orders_table_number ON orders(table_number);");
      db.exec("CREATE INDEX IF NOT EXISTS idx_orders_employee_id ON orders(employee_id);");
      db.exec("CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);");
    })();
    db.pragma("foreign_keys = ON");
  }
}

/**
 * products_fts only fills itself in going forward, via the triggers in
 * schema.sql - rows inserted before the virtual table existed (i.e. every
 * product on a DB that predates this migration) need a one-time backfill.
 * Can't guard this with "WHERE id NOT IN (SELECT rowid FROM products_fts)"
 * the way it'd work for a normal table: products_fts is an EXTERNAL CONTENT
 * table (content='products'), so a plain read against it passes straight
 * through to `products` for the column values regardless of whether that
 * rowid has actually been indexed - every product would look "already
 * present" even on a totally unindexed table, silently making the backfill
 * a no-op. products_fts_docsize (one row per row that's actually been
 * indexed) is the real signal instead.
 */
function backfillProductsFts(): void {
  const { indexed } = db.prepare("SELECT COUNT(*) AS indexed FROM products_fts_docsize").get() as { indexed: number };
  if (indexed > 0) return;
  db.exec(`INSERT INTO products_fts (rowid, name, description) SELECT id, name, description FROM products;`);
}

// Seeded here rather than only in db/seed.ts, since `npm run dev` never runs
// seed.ts automatically - without a default row, orderService.applyPromoPricing
// would have nothing to price a promo with on any DB that's only ever been
// migrated (not freshly `db:reset`). INSERT OR IGNORE keeps an admin's
// already-edited price untouched on subsequent migrations.
function seedDefaultPromoSettings(): void {
  const insert = db.prepare<[string, number, number]>(
    "INSERT OR IGNORE INTO promo_settings (promo_type, price, soda_surcharge) VALUES (?, ?, ?)",
  );
  insert.run("duo", 37000, 0);
  insert.run("pizza_xl", 76000, 2000);
}

/** Adds a column to a table that predates it, without touching existing rows. No-op if already present. */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Renames a column on a table that predates the rename. No-op if already renamed or the old column is absent. */
function renameColumnIfExists(table: string, from: string, to: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (
    columns.some((c) => c.name === from) &&
    !columns.some((c) => c.name === to)
  ) {
    db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
  }
}

/**
 * Adds order_payments.net_amount (products-only slice of gross_amount, tip/fee
 * excluded) and tightens discount's CHECK from <=gross_amount to <=net_amount -
 * discounts apply to products, not tip/delivery fee. SQLite can't alter a CHECK
 * constraint in place, so this rebuilds the table: create one with the target
 * schema, copy rows across (computing net_amount for each), drop the old
 * table, rename the new one into place. No-op if net_amount already exists.
 */
function addNetAmountToOrderPayments(): void {
  const columns = db.prepare("PRAGMA table_info(order_payments)").all() as {
    name: string;
  }[];
  if (columns.some((c) => c.name === "net_amount")) return;

  db.pragma("foreign_keys = OFF");
  db.transaction(() => {
    db.exec(`
      CREATE TABLE order_payments_new (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        method       TEXT NOT NULL CHECK (method IN ('cash', 'card', 'transfer')),
        gross_amount INTEGER NOT NULL CHECK (gross_amount > 0),
        tip_amount   INTEGER NOT NULL DEFAULT 0 CHECK (tip_amount >= 0 AND tip_amount <= gross_amount),
        delivery_fee INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0 AND delivery_fee <= gross_amount),
        net_amount   INTEGER NOT NULL CHECK (net_amount >= 0),
        discount     INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= net_amount),
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
    db.exec(`
      INSERT INTO order_payments_new (id, order_id, method, gross_amount, tip_amount, delivery_fee, net_amount, discount, created_at)
      SELECT id, order_id, method, gross_amount, tip_amount, delivery_fee, gross_amount - tip_amount - delivery_fee, discount, created_at
      FROM order_payments;
    `);
    db.exec("DROP TABLE order_payments;");
    db.exec("ALTER TABLE order_payments_new RENAME TO order_payments;");
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_order_payments_order_id ON order_payments(order_id);",
    );
  })();
  db.pragma("foreign_keys = ON");
}

/** Drops a column from a table that predates its removal. No-op if already gone. */
function dropColumnIfExists(table: string, column: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

const shouldReset = process.argv.includes("--reset");

if (shouldReset) {
  reset();
  console.log("Dropped existing tables.");
}

migrate();
console.log("Schema migrated.");
