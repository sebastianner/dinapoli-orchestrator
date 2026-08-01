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
  PizzaFlavorSearchResult,
  ProductSize,
  DrinkFlavor,
  AdminDrinkFlavor,
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
  is_available: 0 | 1;
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
// Not filtered to is_available = 1 - a sold-out flavor stays visible (as a
// disabled tile, see the pizza/calzone flavor pickers) instead of
// disappearing outright, same as products (see getCategoryProducts above).
const getGroupFlavors = db.prepare<[number], PizzaGroupFlavorRow>(
  `SELECT f.key AS id, f.name, f.description, f.is_available
   FROM pizza_group_flavors gf
   JOIN pizza_flavors f ON f.id = gf.flavor_id
   WHERE gf.group_id = ?
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
const getProductDrinkFlavors = db.prepare<[number], DrinkFlavor>(
  `SELECT df.key AS id, df.name
   FROM product_drink_flavors pdf
   JOIN drink_flavors df ON df.id = pdf.flavor_id
   WHERE pdf.product_id = ?
   ORDER BY df.id`
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
      isAvailable: f.is_available === 1,
    }));
    return { id: group.key, name: group.name, sizes, flavors };
  });

  return { id: 'pizzas', name: 'Pizzas', groups };
}

/** Shared by buildProductCategory and searchProducts so a product looks the same however it was found. */
function rowToProduct(p: CategoryProductRow): Product {
  const sizes = getProductSizes.all(p.id);
  const drinkFlavors = getProductDrinkFlavors.all(p.id);

  return {
    id: p.id_key,
    name: p.name,
    isAvailable: p.is_available === 1,
    ...(p.price != null ? { price: p.price } : {}),
    ...(sizes.length ? { sizes } : {}),
    ...(drinkFlavors.length ? { drinkFlavors } : {}),
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

interface PizzaFlavorSearchRow {
  /** Numeric PK - needed for the group-membership lookup below, not part of the response shape itself (that's `id`, the string key). */
  flavor_id: number;
  id: string;
  name: string;
  description: string | null;
  is_available: 0 | 1;
}

const searchPizzaFlavorsByTrigram = db.prepare<[string], PizzaFlavorSearchRow>(
  `SELECT f.id AS flavor_id, f.key AS id, f.name, f.description, f.is_available
   FROM pizza_flavors_fts pf
   JOIN pizza_flavors f ON f.id = pf.rowid
   WHERE pizza_flavors_fts MATCH ?
   ORDER BY rank
   LIMIT ${SEARCH_RESULT_LIMIT}`
);
const searchPizzaFlavorsByPrefix = db.prepare<[string, string], PizzaFlavorSearchRow>(
  `SELECT id AS flavor_id, key AS id, name, description, is_available
   FROM pizza_flavors
   WHERE name LIKE ? OR description LIKE ?
   ORDER BY name
   LIMIT ${SEARCH_RESULT_LIMIT}`
);

/**
 * Fuzzy/typo-tolerant pizza flavor search for the pizza size picker's search
 * bar - same trigram approach as searchProducts above. Results span both
 * pizza_groups (classic/special) rather than being scoped to one, so each
 * result carries groupIds telling the caller which group(s) it belongs to
 * (see getFlavorGroupKeys, shared with the admin pizza flavor endpoints).
 */
export function searchPizzaFlavors(query: unknown): PizzaFlavorSearchResult[] {
  if (typeof query !== 'string' || query.trim() === '') return [];
  const trigramQuery = buildTrigramMatchQuery(query);
  const rows = trigramQuery
    ? searchPizzaFlavorsByTrigram.all(trigramQuery)
    : searchPizzaFlavorsByPrefix.all(`${query.trim()}%`, `${query.trim()}%`);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    isAvailable: row.is_available === 1,
    groupIds: getFlavorGroupKeys.all(row.flavor_id).map((g) => g.key),
  }));
}

// ---------------------------------------------------------------------------
// Admin settings (/ajustes/menu-settings) - unlike everything above, these
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
    drinkFlavors: getProductDrinkFlavors.all(row.id),
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

  if (typeof categoryId !== 'string') throw new ValidationError('categoryId es obligatorio');
  const category = getCategoryIdByKey.get(categoryId);
  if (!category) throw new ValidationError(`categoryId desconocido '${categoryId}'`);

  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('el nombre es obligatorio');
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new ValidationError('la descripción debe ser una cadena de texto o nula');
  }
  if (!isPositiveInt(price)) throw new ValidationError('el precio debe ser un número entero positivo');

  const key = slugifyProductKey(name);
  if (!key) throw new ValidationError('el nombre debe contener al menos una letra o un número');

  try {
    const result = insertProduct.run(category.id, key, name.trim(), (description as string | null) ?? null, price, isAvailable === false ? 0 : 1);
    return rowToAdminProduct(getProductRowById.get(Number(result.lastInsertRowid))!);
  } catch (err) {
    if (isConstraintViolation(err, 'UNIQUE')) throw new ValidationError(`ya existe un producto con un nombre similar a "${name}" en esta categoría`);
    throw err;
  }
}

/** Admin-only. Every field optional - only what's passed changes. Can't retarget category/rename the key, or touch per-size pricing/options in this pass. */
export function updateProduct(id: unknown, input: unknown): AdminProduct {
  if (!isPositiveInt(id)) throw new ValidationError('id de producto inválido');
  const existing = getProductRowById.get(id);
  if (!existing) throw new NotFoundError(`producto ${id} no encontrado`);

  const { name, description, price, isAvailable } = (input ?? {}) as Record<string, unknown>;

  const nextName = name !== undefined ? name : existing.name;
  if (typeof nextName !== 'string' || nextName.trim() === '') throw new ValidationError('el nombre debe ser una cadena de texto no vacía');

  const nextDescription = description !== undefined ? description : existing.description;
  if (nextDescription !== null && typeof nextDescription !== 'string') throw new ValidationError('la descripción debe ser una cadena de texto o nula');

  if (existing.price == null && price !== undefined) {
    throw new ValidationError(`el producto ${id} tiene precio por tamaño, no un precio fijo`);
  }
  const nextPrice = price !== undefined ? price : existing.price;
  if (nextPrice != null && !isPositiveInt(nextPrice)) throw new ValidationError('el precio debe ser un número entero positivo');

  const nextAvailable = isAvailable !== undefined ? Boolean(isAvailable) : existing.is_available === 1;

  updateProductRow.run(nextName.trim(), (nextDescription as string | null) ?? null, nextPrice as number | null, nextAvailable ? 1 : 0, id);
  return rowToAdminProduct(getProductRowById.get(id)!);
}

const getProductSizeRow = db.prepare<[number, string], { id: number }>('SELECT id FROM product_sizes WHERE product_id = ? AND key = ?');
const updateProductSizePriceRow = db.prepare<[number, number]>('UPDATE product_sizes SET price = ? WHERE id = ?');

/** Admin-only. Sets the price of one size (e.g. 'small'/'large' on the calzone) of a product that's priced per size, not flat - see updateProduct. */
export function updateProductSize(productId: unknown, sizeKey: unknown, input: unknown): AdminProduct {
  if (!isPositiveInt(productId)) throw new ValidationError('id de producto inválido');
  if (typeof sizeKey !== 'string') throw new ValidationError('id de tamaño inválido');
  if (!getProductRowById.get(productId)) throw new NotFoundError(`producto ${productId} no encontrado`);
  const size = getProductSizeRow.get(productId, sizeKey);
  if (!size) throw new NotFoundError(`el tamaño '${sizeKey}' no está disponible para el producto ${productId}`);

  const { price } = (input ?? {}) as Record<string, unknown>;
  if (!isPositiveInt(price)) throw new ValidationError('el precio debe ser un número entero positivo');

  updateProductSizePriceRow.run(price, size.id);
  return rowToAdminProduct(getProductRowById.get(productId)!);
}

const getAllDrinkFlavorRows = db.prepare<[], { id: number; key: string; name: string }>('SELECT id, key, name FROM drink_flavors ORDER BY name');
const getDrinkFlavorByKey = db.prepare<[string], { id: number }>('SELECT id FROM drink_flavors WHERE key = ?');
const insertDrinkFlavorRow = db.prepare<[string, string]>('INSERT INTO drink_flavors (key, name) VALUES (?, ?)');
const deleteProductDrinkFlavorsRow = db.prepare<[number]>('DELETE FROM product_drink_flavors WHERE product_id = ?');
const insertProductDrinkFlavorRow = db.prepare<[number, number]>('INSERT OR IGNORE INTO product_drink_flavors (product_id, flavor_id) VALUES (?, ?)');

/** Admin-only. The full shared flavor library (see routes/products.ts GET /drink-flavors) - powers the "select existing" half of the per-product flavors dialog. */
export function listDrinkFlavors(): AdminDrinkFlavor[] {
  return getAllDrinkFlavorRows.all();
}

/**
 * Admin-only. Sets the exact set of drink flavors a product offers (0 to
 * many) - each name is found-or-created in the shared drink_flavors library
 * (so e.g. "Coca-Cola" typed for two different products resolves to the same
 * row, same spirit as pizza flavors), then the product's associations are
 * reconciled to match exactly (old links not in the new set are dropped).
 */
export function setProductDrinkFlavors(productId: unknown, input: unknown): AdminProduct {
  if (!isPositiveInt(productId)) throw new ValidationError('id de producto inválido');
  if (!getProductRowById.get(productId)) throw new NotFoundError(`producto ${productId} no encontrado`);

  const { flavors } = (input ?? {}) as Record<string, unknown>;
  if (!Array.isArray(flavors) || !flavors.every((f) => typeof f === 'string')) {
    throw new ValidationError('flavors debe ser un arreglo de cadenas de texto');
  }
  const names = [...new Set(flavors.map((f) => (f as string).trim()).filter((f) => f !== ''))];

  const flavorIds = names.map((name) => {
    const key = slugifyProductKey(name); // shared helper, not actually product-specific despite the name
    if (!key) throw new ValidationError(`el nombre del sabor "${name}" debe contener al menos una letra o un número`);
    const found = getDrinkFlavorByKey.get(key);
    if (found) return found.id;
    const result = insertDrinkFlavorRow.run(key, name);
    return Number(result.lastInsertRowid);
  });

  deleteProductDrinkFlavorsRow.run(productId);
  for (const flavorId of flavorIds) insertProductDrinkFlavorRow.run(productId, flavorId);

  return rowToAdminProduct(getProductRowById.get(productId)!);
}

/** Admin-only. Fails (409) if the product has existing order history - same "don't corrupt order history" reasoning as customerService.deleteCustomer. Mark it unavailable instead if it just shouldn't be orderable anymore. */
export function deleteProduct(id: unknown): void {
  if (!isPositiveInt(id)) throw new ValidationError('id de producto inválido');
  if (!getProductRowById.get(id)) throw new NotFoundError(`producto ${id} no encontrado`);
  try {
    deleteProductRow.run(id);
  } catch (err) {
    if (isConstraintViolation(err, 'FOREIGN KEY')) {
      throw new ConflictError(`el producto ${id} tiene órdenes asociadas y no se puede eliminar - márcalo como no disponible en su lugar`);
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

interface FlavorRow {
  id: number;
  key: string;
  name: string;
  description: string | null;
  is_available: 0 | 1;
}

const getAllFlavorRows = db.prepare<[], FlavorRow>('SELECT id, key, name, description, is_available FROM pizza_flavors ORDER BY id');
const getFlavorRowById = db.prepare<[number], FlavorRow>('SELECT id, key, name, description, is_available FROM pizza_flavors WHERE id = ?');
const getFlavorGroupKeys = db.prepare<[number], { key: PizzaGroupId }>(
  `SELECT g.key FROM pizza_group_flavors gf JOIN pizza_groups g ON g.id = gf.group_id WHERE gf.flavor_id = ? ORDER BY g.id`
);
const insertFlavorRow = db.prepare<[string, string, string | null]>(
  'INSERT INTO pizza_flavors (key, name, description, extra_cost, is_available) VALUES (?, ?, ?, 0, 1)'
);
const updateFlavorRow = db.prepare<[string, string | null, number, number]>(
  'UPDATE pizza_flavors SET name = ?, description = ?, is_available = ? WHERE id = ?'
);
const deleteFlavorGroupsRow = db.prepare<[number]>('DELETE FROM pizza_group_flavors WHERE flavor_id = ?');
const insertFlavorGroupRow = db.prepare<[number, number]>('INSERT OR IGNORE INTO pizza_group_flavors (group_id, flavor_id) VALUES (?, ?)');

function rowToAdminPizzaFlavor(row: FlavorRow): AdminPizzaFlavor {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isAvailable: row.is_available === 1,
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
  if (typeof groupId !== 'string') throw new ValidationError('id de grupo inválido');
  const group = getGroupByKey.get(groupId);
  if (!group) throw new NotFoundError(`grupo de pizza '${groupId}' no encontrado`);

  const { name } = (input ?? {}) as Record<string, unknown>;
  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('el nombre es obligatorio');

  updateGroupNameRow.run(name.trim(), group.id);
  return { id: group.key, name: name.trim(), sizes: getGroupSizes.all(group.id) };
}

/** Admin-only. Sets the price a given size sells for within a given category - null keeps it not flat-priced (e.g. 'slice', priced via portion splitting). */
export function updatePizzaGroupSize(groupId: unknown, sizeId: unknown, input: unknown): AdminPizzaGroup {
  if (typeof groupId !== 'string') throw new ValidationError('id de grupo inválido');
  if (typeof sizeId !== 'string') throw new ValidationError('id de tamaño inválido');
  const group = getGroupByKey.get(groupId);
  if (!group) throw new NotFoundError(`grupo de pizza '${groupId}' no encontrado`);
  const size = getSizeByKey.get(sizeId);
  if (!size) throw new NotFoundError(`tamaño de pizza '${sizeId}' no encontrado`);
  if (!getGroupSizeRow.get(group.id, size.id)) throw new NotFoundError(`el tamaño '${sizeId}' no está disponible en el grupo '${groupId}'`);

  const { price } = (input ?? {}) as Record<string, unknown>;
  if (price !== null && price !== undefined && !isPositiveInt(price)) {
    throw new ValidationError('el precio debe ser un número entero positivo o nulo');
  }

  updateGroupSizePriceRow.run(price === undefined ? null : (price as number | null), group.id, size.id);
  return { id: group.key, name: group.name, sizes: getGroupSizes.all(group.id) };
}

function normalizeGroupIds(groupIds: unknown): { id: number; key: PizzaGroupId; name: string }[] {
  if (!Array.isArray(groupIds) || groupIds.length === 0 || !groupIds.every((g) => typeof g === 'string')) {
    throw new ValidationError('groupIds debe ser un arreglo no vacío de ids de grupos de pizza');
  }
  return groupIds.map((key) => {
    const group = getGroupByKey.get(key as string);
    if (!group) throw new ValidationError(`grupo de pizza desconocido '${key}'`);
    return group;
  });
}

/** Admin-only. Creates a new pizza flavor, offered under every group in groupIds. */
export function createPizzaFlavor(input: unknown): AdminPizzaFlavor {
  const { name, description, groupIds } = (input ?? {}) as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim() === '') throw new ValidationError('el nombre es obligatorio');
  if (description !== undefined && description !== null && typeof description !== 'string') {
    throw new ValidationError('la descripción debe ser una cadena de texto o nula');
  }
  const groups = normalizeGroupIds(groupIds);

  const key = slugifyProductKey(name); // shared helper, not actually product-specific despite the name
  if (!key) throw new ValidationError('el nombre debe contener al menos una letra o un número');

  try {
    const result = insertFlavorRow.run(key, name.trim(), (description as string | null) ?? null);
    const flavorId = Number(result.lastInsertRowid);
    for (const group of groups) insertFlavorGroupRow.run(group.id, flavorId);
    return rowToAdminPizzaFlavor(getFlavorRowById.get(flavorId)!);
  } catch (err) {
    if (isConstraintViolation(err, 'UNIQUE')) throw new ValidationError(`ya existe un sabor con un nombre similar a "${name}"`);
    throw err;
  }
}

/** Admin-only. Every field optional - only what's passed changes. Can't rename the key or delete a flavor in this pass (see section header). */
export function updatePizzaFlavor(id: unknown, input: unknown): AdminPizzaFlavor {
  if (!isPositiveInt(id)) throw new ValidationError('id de sabor inválido');
  const existing = getFlavorRowById.get(id);
  if (!existing) throw new NotFoundError(`sabor de pizza ${id} no encontrado`);

  const { name, description, isAvailable, groupIds } = (input ?? {}) as Record<string, unknown>;

  const nextName = name !== undefined ? name : existing.name;
  if (typeof nextName !== 'string' || nextName.trim() === '') throw new ValidationError('el nombre debe ser una cadena de texto no vacía');

  const nextDescription = description !== undefined ? description : existing.description;
  if (nextDescription !== null && typeof nextDescription !== 'string') throw new ValidationError('la descripción debe ser una cadena de texto o nula');

  const nextAvailable = isAvailable !== undefined ? Boolean(isAvailable) : existing.is_available === 1;

  updateFlavorRow.run(nextName.trim(), (nextDescription as string | null) ?? null, nextAvailable ? 1 : 0, id);

  if (groupIds !== undefined) {
    const groups = normalizeGroupIds(groupIds);
    deleteFlavorGroupsRow.run(id);
    for (const group of groups) insertFlavorGroupRow.run(group.id, id);
  }

  return rowToAdminPizzaFlavor(getFlavorRowById.get(id)!);
}
