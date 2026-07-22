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
}

const shouldReset = process.argv.includes('--reset');

if (shouldReset) {
  reset();
  console.log('Dropped existing tables.');
}

migrate();
console.log('Schema migrated.');
