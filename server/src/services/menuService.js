import db from '../db/index.js';

const getPizzaGroups = db.prepare('SELECT id, key, name FROM pizza_groups ORDER BY id');
const getGroupSizes = db.prepare(
  `SELECT s.key AS id, s.name, s.slices, s.max_flavors AS maxFlavors, gs.price
   FROM pizza_group_sizes gs
   JOIN pizza_sizes s ON s.id = gs.size_id
   WHERE gs.group_id = ?
   ORDER BY s.id`
);
const getGroupFlavors = db.prepare(
  `SELECT f.key AS id, f.name, f.description
   FROM pizza_group_flavors gf
   JOIN pizza_flavors f ON f.id = gf.flavor_id
   WHERE gf.group_id = ? AND f.is_available = 1
   ORDER BY f.id`
);

const getProductCategories = db.prepare(
  `SELECT id, key, name FROM categories ORDER BY id`
);
const getCategoryProducts = db.prepare(
  `SELECT id, key AS id_key, name, description, price, requires_pizza_flavor
   FROM products
   WHERE category_id = ? AND is_available = 1
   ORDER BY id`
);
const getProductSizes = db.prepare(
  `SELECT key AS id, name, price FROM product_sizes WHERE product_id = ? ORDER BY product_sizes.id`
);
const getProductOptions = db.prepare(
  `SELECT name FROM product_options WHERE product_id = ? ORDER BY id`
);

function buildPizzaCategory() {
  const groups = getPizzaGroups.all().map((group) => {
    const sizes = getGroupSizes.all(group.id).map((s) => ({
      id: s.id,
      name: s.name,
      slices: s.slices,
      maxFlavors: s.maxFlavors,
      ...(s.price != null ? { price: s.price } : {}),
    }));
    const flavors = getGroupFlavors.all(group.id).map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description ?? '',
    }));
    return { id: group.key, name: group.name, sizes, flavors };
  });

  return { id: 'pizzas', name: 'Pizzas', groups };
}

function buildProductCategory(category) {
  const products = getCategoryProducts.all(category.id).map((p) => {
    const sizes = getProductSizes.all(p.id);
    const options = getProductOptions.all(p.id).map((o) => o.name);

    return {
      id: p.id_key,
      name: p.name,
      ...(p.price != null ? { price: p.price } : {}),
      ...(sizes.length ? { sizes } : {}),
      ...(options.length ? { options } : {}),
      ...(p.requires_pizza_flavor ? { pizzaFlavor: true } : {}),
    };
  });

  return { id: category.key, name: category.name, products };
}

export function getMenu() {
  const categories = [buildPizzaCategory()];
  for (const category of getProductCategories.all()) {
    categories.push(buildProductCategory(category));
  }
  return { menu: categories };
}
