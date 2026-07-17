import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './index.js';
import type { Menu, PizzaCategory, ProductCategory } from '../types/dinapoly-types.js';
import { isPizzaCategory } from '../types/dinapoly-types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NUM_TABLES = 9;

function seedRestaurantTables(): void {
  const insert = db.prepare<[number, string]>('INSERT OR IGNORE INTO restaurant_tables (number, status) VALUES (?, ?)');
  const insertAll = db.transaction(() => {
    for (let n = 1; n <= NUM_TABLES; n++) insert.run(n, 'free');
  });
  insertAll();
}

function seedCashRegisterSettings(): void {
  db.prepare('INSERT OR IGNORE INTO cash_register_settings (id, default_opening_cash) VALUES (1, 0)').run();
}

function seedPizzas(pizzaCategory: PizzaCategory): void {
  const insertGroup = db.prepare<[string, string]>('INSERT OR IGNORE INTO pizza_groups (key, name) VALUES (?, ?)');
  const getGroup = db.prepare<[string], { id: number }>('SELECT id FROM pizza_groups WHERE key = ?');
  const insertSize = db.prepare<[string, string, number, number]>(
    'INSERT OR IGNORE INTO pizza_sizes (key, name, slices, max_flavors) VALUES (?, ?, ?, ?)'
  );
  const getSize = db.prepare<[string], { id: number }>('SELECT id FROM pizza_sizes WHERE key = ?');
  const insertGroupSize = db.prepare<[number, number, number | null]>(
    'INSERT INTO pizza_group_sizes (group_id, size_id, price) VALUES (?, ?, ?) ' +
    'ON CONFLICT(group_id, size_id) DO UPDATE SET price = excluded.price'
  );
  const insertFlavor = db.prepare<[string, string, string | null]>(
    'INSERT INTO pizza_flavors (key, name, description, extra_cost, is_available) VALUES (?, ?, ?, 0, 1) ' +
    'ON CONFLICT(key) DO UPDATE SET name = excluded.name, description = excluded.description'
  );
  const getFlavor = db.prepare<[string], { id: number }>('SELECT id FROM pizza_flavors WHERE key = ?');
  const insertGroupFlavor = db.prepare<[number, number]>('INSERT OR IGNORE INTO pizza_group_flavors (group_id, flavor_id) VALUES (?, ?)');

  for (const group of pizzaCategory.groups) {
    insertGroup.run(group.id, group.name);
    const groupId = getGroup.get(group.id)!.id;

    for (const size of group.sizes) {
      insertSize.run(size.id, size.name, size.slices, size.maxFlavors);
      const sizeId = getSize.get(size.id)!.id;
      insertGroupSize.run(groupId, sizeId, size.price ?? null);
    }

    for (const flavor of group.flavors) {
      insertFlavor.run(flavor.id, flavor.name, flavor.description ?? null);
      const flavorId = getFlavor.get(flavor.id)!.id;
      insertGroupFlavor.run(groupId, flavorId);
    }
  }
}

function seedProductCategory(category: ProductCategory): void {
  const insertCategory = db.prepare<[string, string]>('INSERT OR IGNORE INTO categories (key, name) VALUES (?, ?)');
  insertCategory.run(category.id, category.name);
  const categoryId = db.prepare<[string], { id: number }>('SELECT id FROM categories WHERE key = ?').get(category.id)!.id;

  const insertProduct = db.prepare<[number, string, string, number | null, 0 | 1]>(
    'INSERT INTO products (category_id, key, name, description, price, is_available, requires_pizza_flavor) ' +
    'VALUES (?, ?, ?, NULL, ?, 1, ?) ' +
    'ON CONFLICT(category_id, key) DO UPDATE SET name = excluded.name, price = excluded.price, requires_pizza_flavor = excluded.requires_pizza_flavor'
  );
  const getProduct = db.prepare<[number, string], { id: number }>('SELECT id FROM products WHERE category_id = ? AND key = ?');
  const insertSize = db.prepare<[number, string, string, number]>(
    'INSERT INTO product_sizes (product_id, key, name, price) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(product_id, key) DO UPDATE SET name = excluded.name, price = excluded.price'
  );
  const insertOption = db.prepare<[number, string, string]>(
    'INSERT INTO product_options (product_id, key, name) VALUES (?, ?, ?) ' +
    'ON CONFLICT(product_id, key) DO UPDATE SET name = excluded.name'
  );

  for (const product of category.products) {
    insertProduct.run(categoryId, product.id, product.name, product.price ?? null, product.pizzaFlavor ? 1 : 0);
    const productId = getProduct.get(categoryId, product.id)!.id;

    for (const size of product.sizes ?? []) {
      insertSize.run(productId, size.id, size.name, size.price);
    }
    for (const option of product.options ?? []) {
      insertOption.run(productId, option.id, option.name);
    }
  }
}

function seedMenu(): void {
  const menuPath = path.join(__dirname, '..', 'data', 'menu.json');
  const { menu } = JSON.parse(fs.readFileSync(menuPath, 'utf8')) as Menu;

  const seedAll = db.transaction(() => {
    for (const category of menu) {
      if (isPizzaCategory(category)) {
        seedPizzas(category);
      } else {
        seedProductCategory(category);
      }
    }
  });
  seedAll();
}

seedRestaurantTables();
seedCashRegisterSettings();
seedMenu();
console.log('Database seeded: restaurant tables, cash register settings, and menu.');
