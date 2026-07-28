import db from '../db/index.js';
import { buildTrigramMatchQuery } from '../utils/trigramSearch.js';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors.js';
import type {
  Menu,
  MenuCategory,
  PizzaCategory,
  PizzaGroup,
  PizzaSize,
  PizzaSizeId,
  PizzaGroupId,
  PizzaFlavor,
  ProductCategory,
  ProductCategoryId,
  Product,
  AdminProduct,
  ProductSearchResult,
  ProductSize,
  AdminPizzaGroup,
  AdminPizzaFlavor,
  PizzaAdminData,
} from '../types/dinapoly-types.js';

interface PizzaGroupRow {
  id: number;
  key: PizzaGroupId;
  name: string;
}

interface PizzaGroupSizeRow {
  id: PizzaSizeId;
  name: string;
  slices: number;
  maxFlavors: number;
  price: number | null;
}

interface PizzaGroupFlavorRow {
  id: string;
  name: string;
  description: string | null;
}

interface CategoryRow {
  id: number;
  key: string;
  name: string;
}

interface CategoryProductRow {
  id: number;
  id_key: string;
  name: string;
  description: string | null;
  price: number | null;
  requires_pizza_flavor: 0 | 1;
  is_available: 0 | 1;
}

const getPizzaGroups = db.prepare<[], PizzaGroupRow>('SELECT id, key, name FROM pizza_groups ORDER BY id');
const getGroupSizes = db.prepare<[number], PizzaGroupSizeRow>(
  `SELECT s.key AS id, s.name, s.slices, s.max_flavors AS maxFlavors, gs.price
   FROM pizza_group_sizes gs
   JOIN pizza_sizes s ON s.id = gs.size_id
   WHERE gs.group_id = ?
   ORDER BY s.id`
);
const getGroupFlavors = db.prepare<[number], PizzaGroupFlavorRow>(
  `SELECT f.key AS id, f.name, f.description
   FROM pizza_group_flavors gf
   JOIN pizza_flavors f ON f.id = gf.flavor_id
   WHERE gf.group_id = ? AND f.is_available = 1
   ORDER BY f.id`
);

const getProductCategories = db.prepare<[], CategoryRow>(`SELECT id, key, name FROM categories ORDER BY id`);
// No longer filtered to is_available = 1 - sold-out products stay visible
// (as a disabled card, see ProductCard.tsx) instead of disappearing outright,
// so customers/staff know an item exists but can't be ordered right now
// rather than it just silently not being there.
const getCategoryProducts = db.prepare<[number], CategoryProductRow>(
  `SELECT id, key AS id_key, name, description, price, requires_pizza_flavor, is_available
   FROM products
   WHERE category_id = ?
   ORDER BY id`
);
const getProductSizes = db.prepare<[number], ProductSize>(
  `SELECT key AS id, name, price FROM product_sizes WHERE product_id = ? ORDER BY product_sizes.id`
);
const getProductOptions = db.prepare<[number], { id: string; name: string }>(
  `SELECT key AS id, name FROM product_options WHERE product_id = ? ORDER BY id`
);

function buildPizzaCategory(): PizzaCategory {
  const groups: PizzaGroup[] = getPizzaGroups.all().map((group) => {
    const sizes: PizzaSize[] = getGroupSizes.all(group.id).map((s) => ({
      id: s.id,
      name: s.name,
      slices: s.slices,
      maxFlavors: s.maxFlavors,
      ...(s.price != null ? { price: s.price } : {}),
    }));
    const flavors: PizzaFlavor[] = getGroupFlavors.all(group.id).map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description ?? '',
    }));
    return { id: group.key, name: group.name, sizes, flavors };
  });

  return { id: 'pizzas', name: 'Pizzas', groups };
}

/** Shared by buildProductCategory and searchProducts so a product looks the same however it was found. */
function rowToProduct(p: CategoryProductRow): Product {
  const sizes = getProductSizes.all(p.id);
  const options = getProductOptions.all(p.id);

  return {
    id: p.id_key,
    name: p.name,
    isAvailable: p.is_available === 1,
    ...(p.price != null ? { price: p.price } : {}),
    ...(sizes.length ? { sizes } : {}),
    ...(options.length ? { options } : {}),
    ...(p.requires_pizza_flavor ? { pizzaFlavor: true } : {}),
  };
}

function buildProductCategory(category: CategoryRow): ProductCategory {
  const products = getCategoryProducts.all(category.id).map(rowToProduct);
  return { id: category.key as ProductCategoryId, name: category.name, products };
}

// Menu order (drives CategorySidebar, /menu/todos, and menu-settings, which
// all just render `menu.menu` in array order): Entradas first, then Pizzas,
// then every other category in their existing `categories` table order.
// Pizzas isn't a `categories` row at all (see buildPizzaCategory), so it has
// to be spliced in by hand rather than just sorted alongside the rest.
export function getMenu(): Menu {
  const productCategories = getProductCategories.all();
  const appetizers = productCategories.find((c) => c.key === 'appetizers');
  const rest = productCategories.filter((c) => c.key !== 'appetizers');

  const categories: MenuCategory[] = [];
  if (appetizers) categories.push(buildProductCategory(appetizers));
  categories.push(buildPizzaCategory());
  for (const category of rest) {
    categories.push(buildProductCategory(category));
  }
  return { menu: categories };
}

const SEARCH_RESULT_LIMIT = 15;

interface ProductSearchRow extends CategoryProductRow {
  category_key: string;
}

// Only pizzas are excluded (no category_id - they're not rows in `products`
// at all, see buildPizzaCategory) - every other product is searchable
// regardless of category, unlike getCategoryProducts which is scoped to one.
const searchProductsByTrigram = db.prepare<[string], ProductSearchRow>(
  `SELECT p.id, p.key AS id_key, p.name, p.description, p.price, p.requires_pizza_flavor, p.is_available, c.key AS category_key
   FROM products_fts f
   JOIN products p ON p.id = f.rowid
   JOIN categories c ON c.id = p.category_id
   WHERE products_fts MATCH ?
   ORDER BY rank
   LIMIT ${SEARCH_RESULT_LIMIT}`
);
const searchProductsByPrefix = db.prepare<[string, string], ProductSearchRow>(
  `SELECT p.id, p.key AS id_key, p.name, p.description, p.price, p.requires_pizza_flavor, p.is_available, c.key AS category_key
   FROM products p
   JOIN categories c ON c.id = p.category_id
   WHERE p.name LIKE ? OR p.description LIKE ?
   ORDER BY p.name
   LIMIT ${SEARCH_RESULT_LIMIT}`
);

/** Fuzzy/typo-tolerant product search for the "Todos" menu tab's search bar - same trigram approach as customerService.searchCustomers. */
export function searchProducts(query: unknown): ProductSearchResult[] {
  if (typeof query !== 'string' || query.trim() === '') return [];
  const trigramQuery = buildTrigramMatchQuery(query);
  const rows = trigramQuery ? searchProductsByTrigram.all(trigramQuery) : searchProductsByPrefix.all(`${query.trim()}%`, `${query.trim()}%`);
  return rows.map((row) => ({ ...rowToProduct(row), categoryId: row.category_key as ProductCategoryId }));
}

// ---------------------------------------------------------------------------
// Admin settings (/dashboard/menu-settings) - unlike everything above, these
// see every product regardless of is_available, and expose the numeric id
// updates/deletes target.
// ---------------------------------------------------------------------------

interface AdminProductRow extends CategoryProductRow {
  category_key: string;
}

const getAllProductsForAdmin = db.prepare<[], AdminProductRow>(
  `SELECT p.id, p.key AS id_key, p.name, p.description, p.price, p.requires_pizza_flavor, p.is_available, c.key AS category_key
   FROM products p
   JOIN categories c ON c.id = p.category_id
   ORDER BY c.id, p.id`
);
const getProductRowById = db.prepare<[number], AdminProductRow>(
  `SELECT p.id, p.key AS id_key, p.name, p.description, p.price, p.requires_pizza_flavor, p.is_available, c.key AS category_key
   FROM products p
   JOIN categories c ON c.id = p.category_id
   WHERE p.id = ?`
);
const getCategoryIdByKey = db.prepare<[string], { id: number }>('SELECT id FROM categories WHERE key = ?');
const insertProduct = db.prepare<[number, string, string, string | null, number, number]>(
  'INSERT INTO products (category_id, key, name, description, price, is_available) VALUES (?, ?, ?, ?, ?, ?)'
);
const updateProductRow = db.prepare<[string, string | null, number | null, number, number]>(
  'UPDATE products SET name = ?, description = ?, price = ?, is_available = ? WHERE id = ?'
);
const deleteProductRow = db.prepare<[number]>('DELETE FROM products WHERE id = ?');

function rowToAdminProduct(row: AdminProductRow): AdminProduct {
  return {
    id: row.id,
    categoryId: row.category_key as ProductCategoryId,
    key: row.id_key,
    name: row.name,
    description: row.description,
    price: row.price,
    isAvailable: row.is_available === 1,
    sizes: getProductSizes.all(row.id),
    options: getProductOptions.all(row.id),
    pizzaFlavor: row.requires_pizza_flavor === 1,
  };
}

export function listAllProductsForAdmin(): AdminProduct[] {
  return getAllProductsForAdmin.all().map(rowToAdminProduct);
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

/** True when a better-sqlite3 error is a constraint violation of the given kind (FOREIGN KEY, UNIQUE, ...). */
function isConstraintViolation(err: unknown, kind: string): boolean {
  return err instanceof Error && new RegExp(kind, 'i').test(err.message);
}

function slugifyProductKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents (á -> a) so keys stay ASCII, matching every seeded key
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Admin-only (see routes/products.ts). Creates a simple flat-priced product -
 * matches the todo's literal scope (name/description/price/category/
 * availability). Products priced per size (calzone) or requiring a pizza
 * flavor (gratinado) still need to be seeded directly, not created here.
 */
export function createProduct(input: unknown): AdminProduct {
  const { categoryId, name, description, price, isAvailable } = (input ?? {}) as Record<string, unknown>;

  if (typeof categoryId !== 'string') throw new ValidationError('categoryId is required');
  const category = getCategoryIdByKey.get(categoryId);
  if (!category) throw new ValidationError(`unknown categoryId '${categoryId}'`);

  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('name is required');
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new ValidationError('description must be a string or null');
  }
  if (!isPositiveInt(price)) throw new ValidationError('price must be a positive integer');

  const key = slugifyProductKey(name);
  if (!key) throw new ValidationError('name must contain at least one letter or number');

  try {
    const result = insertProduct.run(category.id, key, name.trim(), (description as string | null) ?? null, price, isAvailable === false ? 0 : 1);
    return rowToAdminProduct(getProductRowById.get(Number(result.lastInsertRowid))!);
  } catch (err) {
    if (isConstraintViolation(err, 'UNIQUE')) throw new ValidationError(`a product named like "${name}" already exists in this category`);
    throw err;
  }
}

/** Admin-only. Every field optional - only what's passed changes. Can't retarget category/rename the key, or touch per-size pricing/options in this pass. */
export function updateProduct(id: unknown, input: unknown): AdminProduct {
  if (!isPositiveInt(id)) throw new ValidationError('invalid product id');
  const existing = getProductRowById.get(id);
  if (!existing) throw new NotFoundError(`product ${id} not found`);

  const { name, description, price, isAvailable } = (input ?? {}) as Record<string, unknown>;

  const nextName = name !== undefined ? name : existing.name;
  if (typeof nextName !== 'string' || nextName.trim() === '') throw new ValidationError('name must be a non-empty string');

  const nextDescription = description !== undefined ? description : existing.description;
  if (nextDescription !== null && typeof nextDescription !== 'string') throw new ValidationError('description must be a string or null');

  if (existing.price == null && price !== undefined) {
    throw new ValidationError(`product ${id} is priced per size, not with a flat price`);
  }
  const nextPrice = price !== undefined ? price : existing.price;
  if (nextPrice != null && !isPositiveInt(nextPrice)) throw new ValidationError('price must be a positive integer');

  const nextAvailable = isAvailable !== undefined ? Boolean(isAvailable) : existing.is_available === 1;

  updateProductRow.run(nextName.trim(), (nextDescription as string | null) ?? null, nextPrice as number | null, nextAvailable ? 1 : 0, id);
  return rowToAdminProduct(getProductRowById.get(id)!);
}

/** Admin-only. Fails (409) if the product has existing order history - same "don't corrupt order history" reasoning as customerService.deleteCustomer. Mark it unavailable instead if it just shouldn't be orderable anymore. */
export function deleteProduct(id: unknown): void {
  if (!isPositiveInt(id)) throw new ValidationError('invalid product id');
  if (!getProductRowById.get(id)) throw new NotFoundError(`product ${id} not found`);
  try {
    deleteProductRow.run(id);
  } catch (err) {
    if (isConstraintViolation(err, 'FOREIGN KEY')) {
      throw new ConflictError(`product ${id} has existing orders and can't be deleted - mark it unavailable instead`);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Admin pizza CRUD (see routes/pizzaAdmin.ts) - same "regardless of
// availability, numeric ids for updates" spirit as the product admin section
// above, applied to pizza_groups/pizza_sizes/pizza_flavors instead. Sizes
// themselves (slices/maxFlavors) are structural and shared across groups, so
// they're not editable here - only a group's name and its per-size price
// (pizza_group_sizes.price) are, plus flavor name/description/group
// membership. No delete for flavors/groups in this pass - both can be
// referenced by order history (pizza_flavor_id/pizza_group_id), same
// "mark unavailable instead" reasoning as products.
// ---------------------------------------------------------------------------

const getGroupByKey = db.prepare<[string], { id: number; key: PizzaGroupId; name: string }>(
  'SELECT id, key, name FROM pizza_groups WHERE key = ?'
);
const updateGroupNameRow = db.prepare<[string, number]>('UPDATE pizza_groups SET name = ? WHERE id = ?');

const getSizeByKey = db.prepare<[string], { id: number; key: PizzaSizeId }>('SELECT id, key FROM pizza_sizes WHERE key = ?');
const getGroupSizeRow = db.prepare<[number, number], { price: number | null }>(
  'SELECT price FROM pizza_group_sizes WHERE group_id = ? AND size_id = ?'
);
const updateGroupSizePriceRow = db.prepare<[number | null, number, number]>(
  'UPDATE pizza_group_sizes SET price = ? WHERE group_id = ? AND size_id = ?'
);

const getAllFlavorRows = db.prepare<[], { id: number; key: string; name: string; description: string | null }>(
  'SELECT id, key, name, description FROM pizza_flavors ORDER BY id'
);
const getFlavorRowById = db.prepare<[number], { id: number; key: string; name: string; description: string | null }>(
  'SELECT id, key, name, description FROM pizza_flavors WHERE id = ?'
);
const getFlavorGroupKeys = db.prepare<[number], { key: PizzaGroupId }>(
  `SELECT g.key FROM pizza_group_flavors gf JOIN pizza_groups g ON g.id = gf.group_id WHERE gf.flavor_id = ? ORDER BY g.id`
);
const insertFlavorRow = db.prepare<[string, string, string | null]>(
  'INSERT INTO pizza_flavors (key, name, description, extra_cost, is_available) VALUES (?, ?, ?, 0, 1)'
);
const updateFlavorRow = db.prepare<[string, string | null, number]>('UPDATE pizza_flavors SET name = ?, description = ? WHERE id = ?');
const deleteFlavorGroupsRow = db.prepare<[number]>('DELETE FROM pizza_group_flavors WHERE flavor_id = ?');
const insertFlavorGroupRow = db.prepare<[number, number]>('INSERT OR IGNORE INTO pizza_group_flavors (group_id, flavor_id) VALUES (?, ?)');

function rowToAdminPizzaFlavor(row: { id: number; key: string; name: string; description: string | null }): AdminPizzaFlavor {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    groupIds: getFlavorGroupKeys.all(row.id).map((g) => g.key),
  };
}

export function listPizzaAdminData(): PizzaAdminData {
  const groups: AdminPizzaGroup[] = getPizzaGroups.all().map((group) => ({
    id: group.key,
    name: group.name,
    sizes: getGroupSizes.all(group.id),
  }));
  const flavors: AdminPizzaFlavor[] = getAllFlavorRows.all().map(rowToAdminPizzaFlavor);
  return { groups, flavors };
}

/** Admin-only. Renames a pizza category (classic/special) - the group's key/sizes/flavors are unchanged. */
export function updatePizzaGroup(groupId: unknown, input: unknown): AdminPizzaGroup {
  if (typeof groupId !== 'string') throw new ValidationError('invalid group id');
  const group = getGroupByKey.get(groupId);
  if (!group) throw new NotFoundError(`pizza group '${groupId}' not found`);

  const { name } = (input ?? {}) as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('name is required');

  updateGroupNameRow.run(name.trim(), group.id);
  return { id: group.key, name: name.trim(), sizes: getGroupSizes.all(group.id) };
}

/** Admin-only. Sets the price a given size sells for within a given category - null keeps it not flat-priced (e.g. 'slice', priced via portion splitting). */
export function updatePizzaGroupSize(groupId: unknown, sizeId: unknown, input: unknown): AdminPizzaGroup {
  if (typeof groupId !== 'string') throw new ValidationError('invalid group id');
  if (typeof sizeId !== 'string') throw new ValidationError('invalid size id');
  const group = getGroupByKey.get(groupId);
  if (!group) throw new NotFoundError(`pizza group '${groupId}' not found`);
  const size = getSizeByKey.get(sizeId);
  if (!size) throw new NotFoundError(`pizza size '${sizeId}' not found`);
  if (!getGroupSizeRow.get(group.id, size.id)) throw new NotFoundError(`size '${sizeId}' isn't offered in group '${groupId}'`);

  const { price } = (input ?? {}) as Record<string, unknown>;
  if (price !== null && price !== undefined && !isPositiveInt(price)) {
    throw new ValidationError('price must be a positive integer or null');
  }

  updateGroupSizePriceRow.run(price === undefined ? null : (price as number | null), group.id, size.id);
  return { id: group.key, name: group.name, sizes: getGroupSizes.all(group.id) };
}

function normalizeGroupIds(groupIds: unknown): { id: number; key: PizzaGroupId; name: string }[] {
  if (!Array.isArray(groupIds) || groupIds.length === 0 || !groupIds.every((g) => typeof g === 'string')) {
    throw new ValidationError('groupIds must be a non-empty array of pizza group ids');
  }
  return groupIds.map((key) => {
    const group = getGroupByKey.get(key as string);
    if (!group) throw new ValidationError(`unknown pizza group '${key}'`);
    return group;
  });
}

/** Admin-only. Creates a new pizza flavor, offered under every group in groupIds. */
export function createPizzaFlavor(input: unknown): AdminPizzaFlavor {
  const { name, description, groupIds } = (input ?? {}) as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('name is required');
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new ValidationError('description must be a string or null');
  }
  const groups = normalizeGroupIds(groupIds);

  const key = slugifyProductKey(name); // shared helper, not actually product-specific despite the name
  if (!key) throw new ValidationError('name must contain at least one letter or number');

  try {
    const result = insertFlavorRow.run(key, name.trim(), (description as string | null) ?? null);
    const flavorId = Number(result.lastInsertRowid);
    for (const group of groups) insertFlavorGroupRow.run(group.id, flavorId);
    return rowToAdminPizzaFlavor(getFlavorRowById.get(flavorId)!);
  } catch (err) {
    if (isConstraintViolation(err, 'UNIQUE')) throw new ValidationError(`a flavor named like "${name}" already exists`);
    throw err;
  }
}

/** Admin-only. Every field optional - only what's passed changes. Can't rename the key or delete a flavor in this pass (see section header). */
export function updatePizzaFlavor(id: unknown, input: unknown): AdminPizzaFlavor {
  if (!isPositiveInt(id)) throw new ValidationError('invalid flavor id');
  const existing = getFlavorRowById.get(id);
  if (!existing) throw new NotFoundError(`pizza flavor ${id} not found`);

  const { name, description, groupIds } = (input ?? {}) as Record<string, unknown>;

  const nextName = name !== undefined ? name : existing.name;
  if (typeof nextName !== 'string' || nextName.trim() === '') throw new ValidationError('name must be a non-empty string');

  const nextDescription = description !== undefined ? description : existing.description;
  if (nextDescription !== null && typeof nextDescription !== 'string') throw new ValidationError('description must be a string or null');

  updateFlavorRow.run(nextName.trim(), (nextDescription as string | null) ?? null, id);

  if (groupIds !== undefined) {
    const groups = normalizeGroupIds(groupIds);
    deleteFlavorGroupsRow.run(id);
    for (const group of groups) insertFlavorGroupRow.run(group.id, id);
  }

  return rowToAdminPizzaFlavor(getFlavorRowById.get(id)!);
}
