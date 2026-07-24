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
