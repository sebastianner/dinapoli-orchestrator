import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TABLES = [
  'closing_reports',
  'cash_expenses',
  'cash_flow',
  'cash_register_settings',
  'print_jobs',
  'order_item_flavors',
  'order_items',
  'order_payments',
  'orders',
  'employees',
  'pizza_group_flavors',
  'pizza_flavors',
  'pizza_group_sizes',
  'pizza_sizes',
  'pizza_groups',
  'product_options',
  'product_sizes',
  'products',
  'categories',
  'restaurant_tables',
];

function reset(): void {
  db.pragma('foreign_keys = OFF');
  const dropAll = db.transaction(() => {
    for (const table of TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table};`);
    }
  });
  dropAll();
  db.pragma('foreign_keys = ON');
}

function migrate(): void {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  ensureColumn('order_item_flavors', 'portion', 'INTEGER NOT NULL DEFAULT 100 CHECK (portion BETWEEN 1 AND 100)');
  ensureColumn('order_payments', 'delivery_fee', 'INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0 AND delivery_fee <= amount)');
  ensureColumn('order_payments', 'discount', 'INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= amount)');
  ensureColumn('closing_reports', 'tips', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('closing_reports', 'discounts', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'promo_type', "TEXT CHECK (promo_type IS NULL OR promo_type IN ('duo', 'pizza_xl'))");
  // Was just "amount" - renamed to make it unmistakable that this is the GROSS
  // total (items + tip + delivery fee) charged via this method, unlike
  // orders.total (items only). SQLite 3.25+ rewrites the CHECK constraints
  // added above (they reference "amount") to the new name automatically.
  renameColumnIfExists('order_payments', 'amount', 'gross_amount');
  addNetAmountToOrderPayments();
  dropColumnIfExists('orders', 'payment_method');
  dropColumnIfExists('orders', 'tip');
  dropColumnIfExists('orders', 'delivery_fee');
  // Tip/delivery fee/discount are only ever declared at completion now (see
  // order_payments) - this short-lived table held the pre-checkout-editable
  // version of them and is no longer used.
  db.exec('DROP TABLE IF EXISTS order_settlement');
}

/** Adds a column to a table that predates it, without touching existing rows. No-op if already present. */
function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/** Renames a column on a table that predates the rename. No-op if already renamed or the old column is absent. */
function renameColumnIfExists(table: string, from: string, to: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === from) && !columns.some((c) => c.name === to)) {
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
  const columns = db.prepare('PRAGMA table_info(order_payments)').all() as { name: string }[];
  if (columns.some((c) => c.name === 'net_amount')) return;

  db.pragma('foreign_keys = OFF');
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
    db.exec('DROP TABLE order_payments;');
    db.exec('ALTER TABLE order_payments_new RENAME TO order_payments;');
    db.exec('CREATE INDEX IF NOT EXISTS idx_order_payments_order_id ON order_payments(order_id);');
  })();
  db.pragma('foreign_keys = ON');
}

/** Drops a column from a table that predates its removal. No-op if already gone. */
function dropColumnIfExists(table: string, column: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  }
}

const shouldReset = process.argv.includes('--reset');

if (shouldReset) {
  reset();
  console.log('Dropped existing tables.');
}

migrate();
console.log('Schema migrated.');
