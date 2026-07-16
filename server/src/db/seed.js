import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NUM_TABLES = 9;

function seedRestaurantTables() {
  const insert = db.prepare('INSERT OR IGNORE INTO restaurant_tables (number, status) VALUES (?, ?)');
  const insertAll = db.transaction(() => {
    for (let n = 1; n <= NUM_TABLES; n++) insert.run(n, 'free');
  });
  insertAll();
}

function seedPizzas(pizzaCategory) {
  const insertGroup = db.prepare('INSERT OR IGNORE INTO pizza_groups (key, name) VALUES (?, ?)');
  const getGroup = db.prepare('SELECT id FROM pizza_groups WHERE key = ?');
  const insertSize = db.prepare('INSERT OR IGNORE INTO pizza_sizes (key, name, slices, max_flavors) VALUES (?, ?, ?, ?)');
  const getSize = db.prepare('SELECT id FROM pizza_sizes WHERE key = ?');
  const insertGroupSize = db.prepare(
    'INSERT INTO pizza_group_sizes (group_id, size_id, price) VALUES (?, ?, ?) ' +
    'ON CONFLICT(group_id, size_id) DO UPDATE SET price = excluded.price'
  );
  const insertFlavor = db.prepare(
    'INSERT INTO pizza_flavors (key, name, description, extra_cost, is_available) VALUES (?, ?, ?, 0, 1) ' +
    'ON CONFLICT(key) DO UPDATE SET name = excluded.name, description = excluded.description'
  );
  const getFlavor = db.prepare('SELECT id FROM pizza_flavors WHERE key = ?');
  const insertGroupFlavor = db.prepare('INSERT OR IGNORE INTO pizza_group_flavors (group_id, flavor_id) VALUES (?, ?)');

  for (const group of pizzaCategory.groups) {
    insertGroup.run(group.id, group.name);
    const groupId = getGroup.get(group.id).id;

    for (const size of group.sizes) {
      insertSize.run(size.id, size.name, size.slices, size.maxFlavors);
      const sizeId = getSize.get(size.id).id;
      insertGroupSize.run(groupId, sizeId, size.price ?? null);
    }

    for (const flavor of group.flavors) {
      insertFlavor.run(flavor.id, flavor.name, flavor.description ?? null);
      const flavorId = getFlavor.get(flavor.id).id;
      insertGroupFlavor.run(groupId, flavorId);
    }
  }
}

function seedProductCategory(category) {
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (key, name) VALUES (?, ?)');
  insertCategory.run(category.id, category.name);
  const categoryId = db.prepare('SELECT id FROM categories WHERE key = ?').get(category.id).id;

  const insertProduct = db.prepare(
    'INSERT INTO products (category_id, key, name, description, price, is_available, requires_pizza_flavor) ' +
    'VALUES (?, ?, ?, NULL, ?, 1, ?) ' +
    'ON CONFLICT(category_id, key) DO UPDATE SET name = excluded.name, price = excluded.price, requires_pizza_flavor = excluded.requires_pizza_flavor'
  );
  const getProduct = db.prepare('SELECT id FROM products WHERE category_id = ? AND key = ?');
  const insertSize = db.prepare(
    'INSERT INTO product_sizes (product_id, key, name, price) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(product_id, key) DO UPDATE SET name = excluded.name, price = excluded.price'
  );
  const insertOption = db.prepare('INSERT OR IGNORE INTO product_options (product_id, name) VALUES (?, ?)');

  for (const product of category.products) {
    insertProduct.run(categoryId, product.id, product.name, product.price ?? null, product.pizzaFlavor ? 1 : 0);
    const productId = getProduct.get(categoryId, product.id).id;

    for (const size of product.sizes ?? []) {
      insertSize.run(productId, size.id, size.name, size.price);
    }
    for (const option of product.options ?? []) {
      insertOption.run(productId, option);
    }
  }
}

function seedMenu() {
  const menuPath = path.join(__dirname, '..', 'data', 'menu.json');
  const { menu } = JSON.parse(fs.readFileSync(menuPath, 'utf8'));

  const seedAll = db.transaction(() => {
    for (const category of menu) {
      if (category.id === 'pizzas') {
        seedPizzas(category);
      } else {
        seedProductCategory(category);
      }
    }
  });
  seedAll();
}

seedRestaurantTables();
seedMenu();
console.log('Database seeded: restaurant tables and menu.');
