import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TABLES = [
  'order_item_flavors',
  'order_items',
  'orders',
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

function reset() {
  db.pragma('foreign_keys = OFF');
  const dropAll = db.transaction(() => {
    for (const table of TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table};`);
    }
  });
  dropAll();
  db.pragma('foreign_keys = ON');
}

function migrate() {
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
