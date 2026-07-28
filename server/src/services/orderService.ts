import db from '../db/index.js';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors.js';
import { markTableBusy, refreshTableStatus, tableExists } from './tableService.js';
import { processPayment } from './paymentService.js';
import type { PaymentSplit } from './paymentService.js';
import { printBill } from './billingService.js';
import { reprintJob } from './printerService.js';
import { getEmployeeById } from './employeeService.js';
import { getCustomerById } from './customerService.js';
import { getPromoSettings } from './promoSettingsService.js';
import { broadcastOrderUpdate } from '../ws/broadcast.js';
import type {
  Order,
  OrderItem,
  OrderPayment,
  OrderRequest,
  OrderItemRequest,
  PizzaItemRequest,
  ProductItemRequest,
  OrderType,
  OrderStatus,
  PaymentMethod,
  PizzaGroupId,
  PizzaSizeId,
  ProductCategoryId,
  PromoType,
} from '../types/dinapoly-types.js';
import type {
  CategoryRow,
  OrderItemRow,
  OrderPaymentRow,
  OrderRow,
  PizzaFlavorRow,
  PizzaGroupRow,
  PizzaGroupSizeRow,
  PizzaSizeRow,
  PrintJobKind,
  ProductOptionRow,
  ProductRow,
  ProductSizeRow,
  ProductWithCategoryRow,
} from '../types/db.js';

const ORDER_TYPES = new Set<OrderType>(['dine_in', 'takeaway', 'delivery']);
const PAYMENT_METHODS = new Set<PaymentMethod>(['cash', 'card', 'transfer']);

const getPizzaSizeByKey = db.prepare<[string], PizzaSizeRow>('SELECT * FROM pizza_sizes WHERE key = ?');
const getGroupSize = db.prepare<[number, number], PizzaGroupSizeRow>(
  'SELECT * FROM pizza_group_sizes WHERE group_id = ? AND size_id = ?'
);
const getFlavorGroups = db.prepare<[number], PizzaGroupRow>(
  `SELECT g.* FROM pizza_groups g
   JOIN pizza_group_flavors gf ON gf.group_id = g.id
   WHERE gf.flavor_id = ?`
);
const getPizzaFlavorByKey = db.prepare<[string], PizzaFlavorRow>('SELECT * FROM pizza_flavors WHERE key = ?');

const getCategoryByKey = db.prepare<[string], CategoryRow>('SELECT * FROM categories WHERE key = ?');
const getProductByKey = db.prepare<[number, string], ProductRow>('SELECT * FROM products WHERE category_id = ? AND key = ?');
const getProductSizeByKey = db.prepare<[number, string], ProductSizeRow>(
  'SELECT * FROM product_sizes WHERE product_id = ? AND key = ?'
);
const getProductOptionByKey = db.prepare<[number, string], ProductOptionRow>(
  'SELECT * FROM product_options WHERE product_id = ? AND key = ?'
);

interface InsertOrderParams {
  orderType: OrderType;
  employeeId: number;
  tableNumber: number | null;
  customerId: number | null;
  customerAddressId: number | null;
  notes: string | null;
  promoType: PromoType | null;
  total: number;
}

interface InsertOrderItemParams {
  orderId: number;
  itemType: 'pizza' | 'product';
  productId: number | null;
  productSizeId: number | null;
  productOptionId: number | null;
  pizzaGroupId: number | null;
  pizzaSizeId: number | null;
  pizzaFlavorId: number | null;
  quantity: number;
  unitPrice: number;
  notes: string | null;
}

const insertOrder = db.prepare<InsertOrderParams>(
  `INSERT INTO orders (order_type, employee_id, table_number, customer_id, customer_address_id, notes, promo_type, total)
   VALUES (@orderType, @employeeId, @tableNumber, @customerId, @customerAddressId, @notes, @promoType, @total)`
);
const insertOrderItem = db.prepare<InsertOrderItemParams>(
  `INSERT INTO order_items
     (order_id, item_type, product_id, product_size_id, product_option_id,
      pizza_group_id, pizza_size_id, pizza_flavor_id, quantity, unit_price, notes)
   VALUES
     (@orderId, @itemType, @productId, @productSizeId, @productOptionId,
      @pizzaGroupId, @pizzaSizeId, @pizzaFlavorId, @quantity, @unitPrice, @notes)`
);
const insertOrderItemFlavor = db.prepare<[number, number, number]>(
  'INSERT INTO order_item_flavors (order_item_id, flavor_id, portion) VALUES (?, ?, ?)'
);

function isPositiveInt(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) > 0;
}

function isNonNegativeInt(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) >= 0;
}

interface ResolvedItem {
  itemType: 'pizza' | 'product';
  productId: number | null;
  productSizeId: number | null;
  productOptionId: number | null;
  pizzaGroupId: number | null;
  pizzaSizeId: number | null;
  pizzaFlavorId: number | null;
  quantity: number;
  unitPrice: number;
  notes: string | null;
  flavorPortions: { flavorId: number; portion: number }[];
}

function resolvePizzaItem(item: PizzaItemRequest, index: number): ResolvedItem {
  const size = getPizzaSizeByKey.get(item.size);
  if (!size) throw new ValidationError(`items[${index}]: unknown pizza size '${item.size}'`);

  if (!Array.isArray(item.flavors) || item.flavors.length === 0) {
    throw new ValidationError(`items[${index}]: at least one flavor is required`);
  }
  if (item.flavors.length > size.max_flavors) {
    throw new ValidationError(`items[${index}]: size '${item.size}' allows at most ${size.max_flavors} flavor(s)`);
  }
  const uniqueFlavors = new Set(item.flavors.map((f) => f?.flavor));
  if (uniqueFlavors.size !== item.flavors.length) {
    throw new ValidationError(`items[${index}]: duplicate flavors are not allowed`);
  }
  for (const f of item.flavors) {
    if (!isPositiveInt(f?.portion) || f.portion > 100) {
      throw new ValidationError(`items[${index}]: each flavor's portion must be an integer between 1 and 100`);
    }
  }
  const portionSum = item.flavors.reduce((sum, f) => sum + f.portion, 0);
  if (portionSum !== 100) {
    throw new ValidationError(`items[${index}]: flavor portions must sum to 100, got ${portionSum}`);
  }

  // Group is not chosen by the client: it's derived from the flavors picked.
  // A flavor pulls the whole pizza into whichever of its groups prices this
  // size highest (e.g. a single 'special' flavor upgrades an otherwise-classic
  // pizza to the special price, regardless of how small that flavor's portion is).
  const candidateGroups = new Map<number, PizzaGroupRow>();
  const flavors = item.flavors.map(({ flavor: flavorKey, portion }) => {
    const flavor = getPizzaFlavorByKey.get(flavorKey);
    if (!flavor) throw new ValidationError(`items[${index}]: unknown pizza flavor '${flavorKey}'`);
    if (!flavor.is_available) {
      throw new ValidationError(`items[${index}]: flavor '${flavorKey}' is currently unavailable`);
    }
    const groups = getFlavorGroups.all(flavor.id);
    if (groups.length === 0) {
      throw new ValidationError(`items[${index}]: flavor '${flavorKey}' is not offered as a pizza flavor`);
    }
    for (const g of groups) candidateGroups.set(g.id, g);
    return { ...flavor, portion };
  });

  let resolvedGroup: PizzaGroupRow | null = null;
  let groupSize: PizzaGroupSizeRow | null = null;
  for (const group of candidateGroups.values()) {
    const gs = getGroupSize.get(group.id, size.id);
    if (!gs || gs.price == null) continue;
    if (!groupSize || gs.price > (groupSize.price as number)) {
      groupSize = gs;
      resolvedGroup = group;
    }
  }
  if (!resolvedGroup || !groupSize) {
    throw new ValidationError(`items[${index}]: size '${item.size}' is not available for the selected flavor combination`);
  }

  if (!isPositiveInt(item.quantity)) {
    throw new ValidationError(`items[${index}]: quantity must be a positive integer`);
  }

  // Extra cost scales with each flavor's share of the pizza (e.g. a premium
  // topping on only a quarter of the pie only adds a quarter of its extra cost).
  const extraCost = flavors.reduce((sum, f) => sum + Math.round(f.extra_cost * (f.portion / 100)), 0);
  const unitPrice = (groupSize.price as number) + extraCost;

  return {
    itemType: 'pizza',
    productId: null,
    productSizeId: null,
    productOptionId: null,
    pizzaGroupId: resolvedGroup.id,
    pizzaSizeId: size.id,
    pizzaFlavorId: null,
    quantity: item.quantity,
    unitPrice,
    notes: item.notes ?? null,
    flavorPortions: flavors.map((f) => ({ flavorId: f.id, portion: f.portion })),
  };
}

function resolveProductItem(item: ProductItemRequest, index: number): ResolvedItem {
  const category = getCategoryByKey.get(item.category);
  if (!category) throw new ValidationError(`items[${index}]: unknown category '${item.category}'`);

  const product = getProductByKey.get(category.id, item.product);
  if (!product) throw new ValidationError(`items[${index}]: unknown product '${item.product}' in category '${item.category}'`);
  if (!product.is_available) throw new ValidationError(`items[${index}]: product '${item.product}' is currently unavailable`);

  let unitPrice: number;
  let productSizeId: number | null = null;
  const productSizes = db.prepare<[number], ProductSizeRow>('SELECT * FROM product_sizes WHERE product_id = ?').all(product.id);
  if (productSizes.length > 0) {
    if (!item.size) throw new ValidationError(`items[${index}]: 'size' is required for product '${item.product}'`);
    const size = getProductSizeByKey.get(product.id, item.size);
    if (!size) throw new ValidationError(`items[${index}]: unknown size '${item.size}' for product '${item.product}'`);
    unitPrice = size.price;
    productSizeId = size.id;
  } else {
    if (product.price == null) {
      throw new ValidationError(`items[${index}]: product '${item.product}' has no price configured`);
    }
    unitPrice = product.price;
  }

  let productOptionId: number | null = null;
  const productOptions = db.prepare<[number], ProductOptionRow>('SELECT * FROM product_options WHERE product_id = ?').all(product.id);
  if (productOptions.length > 0) {
    if (!item.option) throw new ValidationError(`items[${index}]: 'option' is required for product '${item.product}'`);
    const option = getProductOptionByKey.get(product.id, item.option);
    if (!option) throw new ValidationError(`items[${index}]: unknown option '${item.option}' for product '${item.product}'`);
    productOptionId = option.id;
  }

  let pizzaFlavorId: number | null = null;
  if (product.requires_pizza_flavor) {
    if (!item.pizzaFlavor) throw new ValidationError(`items[${index}]: 'pizzaFlavor' is required for product '${item.product}'`);
    const flavor = getPizzaFlavorByKey.get(item.pizzaFlavor);
    if (!flavor) throw new ValidationError(`items[${index}]: unknown pizza flavor '${item.pizzaFlavor}'`);
    if (!flavor.is_available) throw new ValidationError(`items[${index}]: pizza flavor '${item.pizzaFlavor}' is currently unavailable`);
    unitPrice += flavor.extra_cost;
    pizzaFlavorId = flavor.id;
  }

  if (!isPositiveInt(item.quantity)) {
    throw new ValidationError(`items[${index}]: quantity must be a positive integer`);
  }

  return {
    itemType: 'product',
    productId: product.id,
    productSizeId,
    productOptionId,
    pizzaGroupId: null,
    pizzaSizeId: null,
    pizzaFlavorId,
    quantity: item.quantity,
    unitPrice,
    notes: item.notes ?? null,
    flavorPortions: [],
  };
}

function validateOrderRequest(input: unknown): OrderRequest {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('request body must be an object');
  }
  const orderRequest = input as OrderRequest;
  const { orderType, employeeId, tableNumber, customerId, customerAddressId, items } = orderRequest;

  if (!ORDER_TYPES.has(orderType)) {
    throw new ValidationError(`orderType must be one of ${[...ORDER_TYPES].join(', ')}`);
  }

  // Every order must be attributable to whoever placed it, so a mis-clicked
  // or wrong-user order can't happen silently - see the frontend's matching
  // "select an employee before anything else is reachable" guard in
  // __root.tsx.
  if (!isPositiveInt(employeeId)) {
    throw new ValidationError('employeeId is required - orders must always be associated with an employee');
  }

  if (orderType === 'dine_in') {
    if (!isPositiveInt(tableNumber) || !tableExists(tableNumber)) {
      throw new ValidationError('tableNumber must match one of the current restaurant tables for dine_in orders');
    }
    if (customerId != null && !isPositiveInt(customerId)) {
      throw new ValidationError('customerId must be a positive integer when provided');
    }
  }
  // Customers can be attached to any order type, but takeaway/delivery
  // require one - existence/ownership is checked in createOrder (same
  // pattern as employeeId's active check below).
  if (orderType === 'takeaway') {
    if (!isPositiveInt(customerId)) throw new ValidationError('customerId is required for takeaway orders');
  }
  if (orderType === 'delivery') {
    if (!isPositiveInt(customerId)) throw new ValidationError('customerId is required for delivery orders');
    if (!isPositiveInt(customerAddressId)) throw new ValidationError('customerAddressId is required for delivery orders');
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items must be a non-empty array');
  }

  if (orderRequest.promoType != null && !PROMO_TYPES.has(orderRequest.promoType)) {
    throw new ValidationError(`promoType must be one of ${[...PROMO_TYPES].join(', ')}`);
  }

  return orderRequest;
}

function resolveItems(items: OrderItemRequest[]): ResolvedItem[] {
  return items.map((item, index) => {
    if (item?.type === 'pizza') return resolvePizzaItem(item, index);
    if (item?.type === 'product') return resolveProductItem(item, index);
    throw new ValidationError(`items[${index}]: type must be 'pizza' or 'product'`);
  });
}

const PROMO_TYPES = new Set<PromoType>(['duo', 'pizza_xl']);
// A single flavor pulled out of the 'duo' promo entirely, whether as a personal
// pizza's only flavor or as a gratinado's pizzaFlavor - these are the same 5
// "special" flavors either way, so one set covers both checks below.
const DUO_EXCLUDED_FLAVORS = new Set(['campesina', 'madrilena', 'atarraya', 'tricaccio', 'ardiente']);
// Coca-Cola and Quatro are the two soft_drink options that cost extra inside
// the 'pizza_xl' promo; every other option (Postobón's own brands, water) is free.
const XL_SODA_SURCHARGE_OPTIONS = new Set(['coca_cola', 'quatro']);

/**
 * Validates that `items` is exactly the required composition for `promoType`,
 * checked against the raw client-submitted keys (not resolveItems' DB ids,
 * which don't carry the string keys needed for the flavor/product exclusions
 * below). Throws ValidationError on any violation; returns nothing on success.
 */
function validatePromoItems(promoType: PromoType, items: OrderItemRequest[]): void {
  for (const [index, item] of items.entries()) {
    if (item.quantity !== 1) {
      throw new ValidationError(`items[${index}]: promo items must have quantity 1`);
    }
  }

  if (promoType === 'duo') {
    if (items.length !== 2) {
      throw new ValidationError(`promo 'duo' requires exactly 2 items, got ${items.length}`);
    }
    items.forEach((item, index) => {
      if (item.type === 'pizza') {
        if (item.size !== 'personal') {
          throw new ValidationError(`items[${index}]: promo 'duo' only allows personal-size pizzas`);
        }
        if (item.flavors.length !== 1 || item.flavors[0].portion !== 100) {
          throw new ValidationError(`items[${index}]: promo 'duo' pizzas can't be split (mitad y mitad) - one flavor only`);
        }
        if (DUO_EXCLUDED_FLAVORS.has(item.flavors[0].flavor)) {
          throw new ValidationError(`items[${index}]: flavor '${item.flavors[0].flavor}' is not included in promo 'duo'`);
        }
        return;
      }
      if (item.type === 'product' && item.category === 'lasagnas') {
        if (item.product === 'mamma_mia') {
          throw new ValidationError(`items[${index}]: lasaña Mamma Mia is not included in promo 'duo'`);
        }
        return;
      }
      if (item.type === 'product' && item.category === 'pastas') {
        if (item.product === 'seafood') {
          throw new ValidationError(`items[${index}]: pasta Marinera is not included in promo 'duo'`);
        }
        return;
      }
      if (item.type === 'product' && item.category === 'gratinados') {
        if (item.pizzaFlavor && DUO_EXCLUDED_FLAVORS.has(item.pizzaFlavor)) {
          throw new ValidationError(`items[${index}]: gratinado flavor '${item.pizzaFlavor}' is not included in promo 'duo'`);
        }
        return;
      }
      throw new ValidationError(`items[${index}]: promo 'duo' only allows a personal pizza, lasaña, pasta, or gratinado`);
    });
    return;
  }

  // pizza_xl
  if (items.length !== 3) {
    throw new ValidationError(`promo 'pizza_xl' requires exactly 3 items (XL pizza, gaseosa, panes al gratín), got ${items.length}`);
  }
  const pizza = items.find((i) => i.type === 'pizza');
  if (!pizza || pizza.type !== 'pizza' || pizza.size !== 'xlarge') {
    throw new ValidationError(`promo 'pizza_xl' requires one XL pizza`);
  }
  const soda = items.find((i) => i.type === 'product' && i.category === 'drinks' && i.product === 'soft_drink');
  if (!soda) {
    throw new ValidationError(`promo 'pizza_xl' requires one Gaseosa Personal`);
  }
  const bread = items.find((i) => i.type === 'product' && i.category === 'appetizers' && i.product === 'garlic_bread');
  if (!bread) {
    throw new ValidationError(`promo 'pizza_xl' requires one order of Panes al Gratín`);
  }
}

/**
 * Overrides resolveItems' normal menu pricing with the promo's flat price -
 * the primary item (the pizza, or items[0] for 'duo') carries the full
 * admin-configured price (see promoSettingsService), the rest are free,
 * matching how the promo is marketed ("gratis gaseosa y panes al gratín").
 * The XL promo's soda is the one exception: choosing Coca-Cola or Quatro
 * adds a flat surcharge on top. Prices are read live (not cached), so an
 * admin's price change applies starting with the very next order - already-
 * placed orders keep whatever was snapshotted into their unit_price at the
 * time (see printerService.describePromoType for the matching reasoning on
 * the kitchen ticket label). Mutates `resolvedItems` in place; returns the
 * order's total.
 */
function applyPromoPricing(promoType: PromoType, items: OrderItemRequest[], resolvedItems: ResolvedItem[]): number {
  const settings = getPromoSettings(promoType);

  if (promoType === 'duo') {
    resolvedItems[0].unitPrice = settings.price;
    resolvedItems[1].unitPrice = 0;
    return settings.price;
  }

  let total = settings.price;
  items.forEach((item, index) => {
    if (item.type === 'pizza') {
      resolvedItems[index].unitPrice = settings.price;
    } else if (item.type === 'product' && item.category === 'drinks') {
      const surcharge = item.option && XL_SODA_SURCHARGE_OPTIONS.has(item.option) ? settings.sodaSurcharge : 0;
      resolvedItems[index].unitPrice = surcharge;
      total += surcharge;
    } else {
      resolvedItems[index].unitPrice = 0;
    }
  });
  return total;
}

export function createOrder(input: unknown): Order {
  const orderRequest = validateOrderRequest(input);

  const employee = getEmployeeById(orderRequest.employeeId as number); // 404s if the employee doesn't exist - always set, validateOrderRequest already required it
  if (!employee.isActive) {
    throw new ValidationError(`employee ${employee.id} is not active`);
  }

  if (orderRequest.customerId != null) {
    const customer = getCustomerById(orderRequest.customerId); // 404s if the customer doesn't exist
    if (orderRequest.orderType === 'delivery') {
      const address = customer.addresses.find((a) => a.id === orderRequest.customerAddressId);
      if (!address) {
        throw new ValidationError(`customerAddressId ${orderRequest.customerAddressId} does not belong to customer ${orderRequest.customerId}`);
      }
    }
  }

  const resolvedItems = resolveItems(orderRequest.items);

  let total: number;
  if (orderRequest.promoType) {
    validatePromoItems(orderRequest.promoType, orderRequest.items);
    total = applyPromoPricing(orderRequest.promoType, orderRequest.items, resolvedItems);
  } else {
    total = resolvedItems.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
  }

  const orderId = db.transaction(() => {
    const result = insertOrder.run({
      orderType: orderRequest.orderType,
      employeeId: orderRequest.employeeId as number,
      tableNumber: orderRequest.orderType === 'dine_in' ? (orderRequest.tableNumber as number) : null,
      customerId: orderRequest.customerId ?? null,
      customerAddressId: orderRequest.orderType === 'delivery' ? (orderRequest.customerAddressId as number) : null,
      notes: orderRequest.notes ?? null,
      promoType: orderRequest.promoType ?? null,
      total,
    });
    const newOrderId = Number(result.lastInsertRowid);

    for (const item of resolvedItems) {
      const itemResult = insertOrderItem.run({
        orderId: newOrderId,
        itemType: item.itemType,
        productId: item.productId,
        productSizeId: item.productSizeId,
        productOptionId: item.productOptionId,
        pizzaGroupId: item.pizzaGroupId,
        pizzaSizeId: item.pizzaSizeId,
        pizzaFlavorId: item.pizzaFlavorId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        notes: item.notes,
      });
      const orderItemId = Number(itemResult.lastInsertRowid);
      for (const fp of item.flavorPortions) {
        insertOrderItemFlavor.run(orderItemId, fp.flavorId, fp.portion);
      }
    }

    if (orderRequest.orderType === 'dine_in') {
      markTableBusy(orderRequest.tableNumber as number);
    }

    return newOrderId;
  })();

  broadcastOrderUpdate(orderId);
  return getOrderById(orderId);
}

interface OrderJoinRow extends OrderRow {
  employee_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address_street: string | null;
  address_line_2: string | null;
  address_property_type: string | null;
  address_apartment_number: string | null;
  address_tower: string | null;
  address_building_name: string | null;
  address_neighborhood_name: string | null;
  address_city_name: string | null;
}

// customerName/phone/address used to be plain columns on orders itself;
// derived here via LEFT JOIN instead (customer_id/customer_address_id are
// both nullable, so every join below has to be a LEFT JOIN) so that
// printerService/billingService - which only ever read the resolved Order
// object, never the raw row - didn't need to change at all.
const getOrderRow = db.prepare<[number], OrderJoinRow>(
  `SELECT o.*,
          e.name AS employee_name,
          c.name AS customer_name,
          c.phone AS customer_phone,
          ca.street_address AS address_street,
          ca.address_line_2 AS address_line_2,
          ca.property_type AS address_property_type,
          ca.apartment_number AS address_apartment_number,
          ca.tower AS address_tower,
          ca.building_name AS address_building_name,
          n.name AS address_neighborhood_name,
          ci.name AS address_city_name
   FROM orders o
   LEFT JOIN employees e ON e.id = o.employee_id
   LEFT JOIN customers c ON c.id = o.customer_id
   LEFT JOIN customer_addresses ca ON ca.id = o.customer_address_id
   LEFT JOIN neighborhoods n ON n.id = ca.neighborhood_id
   LEFT JOIN cities ci ON ci.id = n.city_id
   WHERE o.id = ?`
);

/** Street + (for apartments) building/tower/unit + neighborhood + city, comma-joined - the same info a delivery kitchen ticket needs, formatted once here for both the ticket and the bill. */
function formatDeliveryAddress(row: OrderJoinRow): string | null {
  if (!row.address_street) return null;
  const parts = [row.address_street];
  if (row.address_line_2) parts.push(row.address_line_2);
  if (row.address_property_type === 'APARTMENT') {
    const unitBits = [
      row.address_building_name,
      row.address_tower ? `Torre ${row.address_tower}` : null,
      row.address_apartment_number ? `Apto ${row.address_apartment_number}` : null,
    ].filter((bit): bit is string => Boolean(bit));
    if (unitBits.length > 0) parts.push(unitBits.join(', '));
  }
  if (row.address_neighborhood_name) parts.push(row.address_neighborhood_name);
  if (row.address_city_name) parts.push(row.address_city_name);
  return parts.join(', ');
}
const getOrderItemRows = db.prepare<[number], OrderItemRow>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
const getOrderPaymentRows = db.prepare<[number], OrderPaymentRow>('SELECT * FROM order_payments WHERE order_id = ? ORDER BY id');
// Tip/delivery fee/discount only ever exist as the per-method breakdown in
// order_payments, written once at completion - so they're 0 for any order
// that hasn't been paid yet (no rows to sum), and the real totals once it has.
const getOrderPaymentTotals = db.prepare<[number], { tip: number; delivery_fee: number; discount: number }>(
  `SELECT COALESCE(SUM(tip_amount), 0) AS tip, COALESCE(SUM(delivery_fee), 0) AS delivery_fee, COALESCE(SUM(discount), 0) AS discount
   FROM order_payments WHERE order_id = ?`
);
const getOrderItemFlavorRows = db.prepare<[number], { key: string; portion: number }>(
  `SELECT f.key, oif.portion FROM order_item_flavors oif
   JOIN pizza_flavors f ON f.id = oif.flavor_id
   WHERE oif.order_item_id = ?
   ORDER BY oif.rowid`
);
const getProductById = db.prepare<[number], ProductWithCategoryRow>(
  'SELECT p.*, c.key AS category_key FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?'
);
const getProductSizeById = db.prepare<[number], ProductSizeRow>('SELECT * FROM product_sizes WHERE id = ?');
const getProductOptionById = db.prepare<[number], ProductOptionRow>('SELECT * FROM product_options WHERE id = ?');
const getPizzaGroupById = db.prepare<[number], PizzaGroupRow>('SELECT * FROM pizza_groups WHERE id = ?');
const getPizzaSizeById = db.prepare<[number], PizzaSizeRow>('SELECT * FROM pizza_sizes WHERE id = ?');
const getPizzaFlavorById = db.prepare<[number], PizzaFlavorRow>('SELECT * FROM pizza_flavors WHERE id = ?');

function rowToOrderItem(row: OrderItemRow): OrderItem {
  const base = {
    id: row.id,
    orderId: row.order_id,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    notes: row.notes,
    printedAt: row.printed_at,
  };

  if (row.item_type === 'pizza') {
    const group = getPizzaGroupById.get(row.pizza_group_id!)!;
    const size = getPizzaSizeById.get(row.pizza_size_id!)!;
    const flavors = getOrderItemFlavorRows.all(row.id).map((f) => ({ flavor: f.key, portion: f.portion }));
    return {
      ...base,
      menuItemRef: null,
      pizzaRef: { group: group.key as PizzaGroupId, size: size.key as PizzaSizeId, flavors },
    };
  }

  const product = getProductById.get(row.product_id!)!;
  const size = row.product_size_id ? getProductSizeById.get(row.product_size_id) : null;
  const option = row.product_option_id ? getProductOptionById.get(row.product_option_id) : null;
  const pizzaFlavor = row.pizza_flavor_id ? getPizzaFlavorById.get(row.pizza_flavor_id) : null;

  return {
    ...base,
    menuItemRef: {
      category: product.category_key as ProductCategoryId,
      product: product.key,
      ...(option ? { option: option.key } : {}),
      ...(size ? { size: size.key } : {}),
      ...(pizzaFlavor ? { pizzaFlavor: pizzaFlavor.key } : {}),
    },
    pizzaRef: null,
  };
}

function rowToOrderPayment(row: OrderPaymentRow): OrderPayment {
  return {
    id: row.id,
    orderId: row.order_id,
    method: row.method,
    grossAmount: row.gross_amount,
    tipAmount: row.tip_amount,
    deliveryFee: row.delivery_fee,
    netAmount: row.net_amount,
    discount: row.discount,
    createdAt: row.created_at,
  };
}

export function getOrderById(id: number): Order {
  const row = getOrderRow.get(id);
  if (!row) throw new NotFoundError(`order ${id} not found`);

  const items = getOrderItemRows.all(id).map(rowToOrderItem);
  const payments = getOrderPaymentRows.all(id).map(rowToOrderPayment);
  const totals = getOrderPaymentTotals.get(id)!;

  return {
    id: row.id,
    orderType: row.order_type,
    status: row.status,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    tableNumber: row.table_number,
    customerId: row.customer_id,
    customerAddressId: row.customer_address_id,
    customerName: row.customer_name,
    phone: row.customer_phone,
    address: formatDeliveryAddress(row),
    total: row.total,
    tip: totals.tip,
    deliveryFee: totals.delivery_fee,
    discount: totals.discount,
    grandTotal: row.total + totals.tip + totals.delivery_fee,
    promoType: row.promo_type as PromoType | null,
    notes: row.notes,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    items,
    payments,
  };
}

const deleteOrderRow = db.prepare<[number]>('DELETE FROM orders WHERE id = ?');

/**
 * Permanently removes an order and everything derived from it - order_items,
 * order_item_flavors, order_payments, print_jobs - via the existing
 * ON DELETE CASCADE foreign keys (see schema.sql), all in one statement.
 * Irreversible: there is no soft-delete/undo, unlike employees.isActive.
 * Callers (routes/orders.ts) restrict this to admins.
 */
export function deleteOrder(id: number): void {
  const order = getOrderById(id); // 404s if it doesn't exist; also needed below to know whether to free its table

  deleteOrderRow.run(id);
  // Reuses 'order_updated' rather than a distinct type - the frontend already
  // treats a 404 on refetch as "gone" and drops it from every cache (see
  // LiveOrderUpdates.tsx), so no other client is left showing a deleted order.
  broadcastOrderUpdate(id);
  // Deleting a dine_in order can be the table's last open order - recompute
  // free/busy the same way completing one does, instead of leaving it stuck
  // busy forever (this order can no longer be counted either way).
  if (order.orderType === 'dine_in') {
    refreshTableStatus(order.tableNumber as number);
  }
}

/**
 * `date` matches orders whose `created_at` falls on that Bogotá business day
 * (same UTC-5 convention as End-of-Day's sales aggregation), regardless of
 * status. `orderType` is the "category" filter from the Order History page.
 */
export interface ListOrdersFilter {
  status?: string;
  date?: string;
  orderType?: string;
  /** 1-indexed. Both page and pageSize must be set together to paginate; omitting both returns every match (unchanged legacy behavior). */
  page?: number;
  pageSize?: number;
}

export interface ListOrdersResult {
  orders: Order[];
  /** Total matches across all pages, not just this page's length - lets the caller render "12 of 340". */
  total: number;
}

const MAX_PAGE_SIZE = 200;

export function listOrders({ status, date, orderType, page, pageSize }: ListOrdersFilter = {}): ListOrdersResult {
  if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError("date must be in 'YYYY-MM-DD' format");
  }
  if (orderType != null && !ORDER_TYPES.has(orderType as OrderType)) {
    throw new ValidationError(`orderType must be one of ${[...ORDER_TYPES].join(', ')}`);
  }
  if (page != null && !isPositiveInt(page)) {
    throw new ValidationError('page must be a positive integer');
  }
  if (pageSize != null && (!isPositiveInt(pageSize) || pageSize > MAX_PAGE_SIZE)) {
    throw new ValidationError(`pageSize must be a positive integer up to ${MAX_PAGE_SIZE}`);
  }

  const conditions: string[] = [];
  const params: string[] = [];
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (date) {
    conditions.push(`date(created_at, '-5 hours') = ?`);
    params.push(date);
  }
  if (orderType) {
    conditions.push('order_type = ?');
    params.push(orderType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = db.prepare<string[], { count: number }>(`SELECT COUNT(*) as count FROM orders ${where}`).get(...params)!.count;

  let query = `SELECT id FROM orders ${where} ORDER BY id`;
  const queryParams = [...params];
  if (page != null && pageSize != null) {
    query += ' LIMIT ? OFFSET ?';
    queryParams.push(String(pageSize), String((page - 1) * pageSize));
  }
  const rows = db.prepare<string[], { id: number }>(query).all(...queryParams);
  return { orders: rows.map((r) => getOrderById(r.id)), total };
}

const insertOrderPayment = db.prepare<[number, PaymentMethod, number, number, number, number, number]>(
  'INSERT INTO order_payments (order_id, method, gross_amount, tip_amount, delivery_fee, net_amount, discount) VALUES (?, ?, ?, ?, ?, ?, ?)'
);
const markCompleted = db.prepare<[number]>(
  `UPDATE orders SET status = 'COMPLETED', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
);

const ADDABLE_ITEM_STATUSES = new Set<OrderStatus>(['PENDING', 'PRINTING', 'ACTIVE']);
const addToOrderTotal = db.prepare<[number, number]>('UPDATE orders SET total = total + ? WHERE id = ?');
const markOrderPending = db.prepare<[number]>(`UPDATE orders SET status = 'PENDING' WHERE id = ?`);

/**
 * Adds items to an order that hasn't been completed yet. If the order is
 * already ACTIVE (its original kitchen ticket already printed), this bounces
 * it back to PENDING so the same queue pass that printed the original ticket
 * picks it up again - queueService.processOrder tells "first ticket" from
 * "addition" apart by whether any of the order's items already have
 * printed_at set, printing an addendum (new items only) in that case instead
 * of the whole order again. The caller (routes/orders.ts) nudges the queue
 * worker afterward so this doesn't wait for the next poll tick.
 */
export function addOrderItems(id: number, items: unknown): Order {
  const order = getOrderById(id);
  if (!ADDABLE_ITEM_STATUSES.has(order.status)) {
    throw new ConflictError(
      `order ${id} cannot accept new items from status ${order.status} (must be PENDING, PRINTING, or ACTIVE)`
    );
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items must be a non-empty array');
  }

  const resolvedItems = resolveItems(items as OrderItemRequest[]);
  const addedTotal = resolvedItems.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);

  db.transaction(() => {
    for (const item of resolvedItems) {
      const itemResult = insertOrderItem.run({
        orderId: id,
        itemType: item.itemType,
        productId: item.productId,
        productSizeId: item.productSizeId,
        productOptionId: item.productOptionId,
        pizzaGroupId: item.pizzaGroupId,
        pizzaSizeId: item.pizzaSizeId,
        pizzaFlavorId: item.pizzaFlavorId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        notes: item.notes,
      });
      const orderItemId = Number(itemResult.lastInsertRowid);
      for (const fp of item.flavorPortions) {
        insertOrderItemFlavor.run(orderItemId, fp.flavorId, fp.portion);
      }
    }
    addToOrderTotal.run(addedTotal, id);
    if (order.status === 'ACTIVE') {
      markOrderPending.run(id);
    }
  })();

  broadcastOrderUpdate(id);
  return getOrderById(id);
}

const updateTableNumber = db.prepare<[number, number]>('UPDATE orders SET table_number = ? WHERE id = ?');

/**
 * Reassigns a dine_in order to a different table - correcting a mistake at
 * seating, or moving a party mid-service. Admin-only (see routes/orders.ts).
 * Frees the old table (unless another of its open orders still occupies it -
 * refreshTableStatus recomputes rather than assuming) and marks the new one
 * busy. No-op (but still returns the order) if the table isn't actually
 * changing.
 */
export function updateOrderTable(id: number, tableNumber: unknown): Order {
  const order = getOrderById(id);
  if (order.orderType !== 'dine_in') {
    throw new ValidationError(`order ${id} is a ${order.orderType} order, not dine_in - it has no table to reassign`);
  }
  if (order.status === 'COMPLETED') {
    throw new ConflictError(`order ${id} is already completed`);
  }
  if (!isPositiveInt(tableNumber) || !tableExists(tableNumber)) {
    throw new ValidationError('tableNumber must match one of the current restaurant tables');
  }

  const previousTable = order.tableNumber as number;
  if (tableNumber === previousTable) return order;

  updateTableNumber.run(tableNumber, id);
  markTableBusy(tableNumber);
  refreshTableStatus(previousTable);
  broadcastOrderUpdate(id);

  return getOrderById(id);
}

/**
 * Validates and normalizes the `payments` a client submits to complete an
 * order. Always required, one entry per method used (a single-method payment
 * is just a one-entry array). Tip, delivery fee, and discount are declared
 * here for the first and only time - Order.tip/deliveryFee/discount are
 * always 0 before this point (see getOrderById) and derived from these rows
 * afterward. `grossAmount` must sum to order.grandTotal (order.total plus the
 * declared tip/delivery fee totals); discount is never subtracted from it, so
 * the full pre-discount price is always on record. `netAmount` (the
 * products-only slice, computed here rather than accepted from the client) is
 * what bounds `discount` - a discount applies to products, not tip/delivery
 * fee. The actual cash collected for a split is `grossAmount - discount`,
 * derived when needed rather than stored.
 */
function resolvePayments(input: unknown, order: Order): PaymentSplit[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new ValidationError('payments must be a non-empty array of { method, grossAmount, tipAmount?, deliveryFee?, discount? }');
  }

  const splits = input.map((p: unknown, index: number) => {
    const method = (p as { method?: unknown })?.method;
    const grossAmount = (p as { grossAmount?: unknown })?.grossAmount;
    const tipAmount = (p as { tipAmount?: unknown })?.tipAmount ?? 0;
    const deliveryFee = (p as { deliveryFee?: unknown })?.deliveryFee ?? 0;
    const discount = (p as { discount?: unknown })?.discount ?? 0;
    if (!PAYMENT_METHODS.has(method as PaymentMethod)) {
      throw new ValidationError(`payments[${index}].method must be one of ${[...PAYMENT_METHODS].join(', ')}`);
    }
    if (!isPositiveInt(grossAmount)) {
      throw new ValidationError(`payments[${index}].grossAmount must be a positive integer amount in COP`);
    }
    if (!isNonNegativeInt(tipAmount)) {
      throw new ValidationError(`payments[${index}].tipAmount must be a non-negative integer amount in COP`);
    }
    if (tipAmount > grossAmount) {
      throw new ValidationError(`payments[${index}].tipAmount cannot exceed payments[${index}].grossAmount`);
    }
    if (!isNonNegativeInt(deliveryFee)) {
      throw new ValidationError(`payments[${index}].deliveryFee must be a non-negative integer amount in COP`);
    }
    if (deliveryFee > grossAmount) {
      throw new ValidationError(`payments[${index}].deliveryFee cannot exceed payments[${index}].grossAmount`);
    }
    const netAmount = grossAmount - tipAmount - deliveryFee;
    if (netAmount < 0) {
      throw new ValidationError(`payments[${index}].tipAmount + deliveryFee cannot exceed payments[${index}].grossAmount`);
    }
    if (!isNonNegativeInt(discount)) {
      throw new ValidationError(`payments[${index}].discount must be a non-negative integer amount in COP`);
    }
    if (discount > netAmount) {
      throw new ValidationError(`payments[${index}].discount cannot exceed payments[${index}]'s product amount (grossAmount minus tip and delivery fee)`);
    }
    return { method: method as PaymentMethod, grossAmount, tipAmount, deliveryFee, netAmount, discount };
  });

  const tipTotal = splits.reduce((s, p) => s + p.tipAmount, 0);
  const deliveryFeeTotal = splits.reduce((s, p) => s + p.deliveryFee, 0);
  if (deliveryFeeTotal > 0 && order.orderType !== 'delivery') {
    throw new ValidationError('deliveryFee can only be set on delivery orders');
  }

  const owed = order.total + tipTotal + deliveryFeeTotal;
  const sum = splits.reduce((s, p) => s + p.grossAmount, 0);
  if (sum !== owed) {
    throw new ValidationError(`payments[].grossAmount must sum to ${owed} (order total + tip + delivery fee), got ${sum}`);
  }

  return splits;
}

/**
 * Marks an order COMPLETED: resolves how it was paid (one method, or a mixed
 * payment split across several - see resolvePayments), records each
 * settlement row, processes payment for the full amount owed (COP), prints
 * the bill, then frees the table if it has no other open orders.
 */
export async function completeOrder(id: number, { payments }: { payments?: unknown } = {}): Promise<Order> {
  const order = getOrderById(id);

  if (order.status !== 'ACTIVE') {
    throw new ConflictError(`order ${id} cannot be completed from status ${order.status} (must be ACTIVE)`);
  }

  const resolvedPayments = resolvePayments(payments, order);

  // Payments and the COMPLETED flip must land atomically - previously these were
  // two separate statements with bill printing (an external, failure-prone side
  // effect - no printer/Chrome on this machine, say) in between. If printing
  // threw, markCompleted never ran, but the payment rows had already been
  // committed - so every retry recorded another duplicate payment against an
  // order stuck ACTIVE forever. Printing is now attempted after both are
  // durably committed together, and its failure no longer blocks completion.
  db.transaction(() => {
    for (const p of resolvedPayments) {
      insertOrderPayment.run(id, p.method, p.grossAmount, p.tipAmount, p.deliveryFee, p.netAmount, p.discount);
    }
    markCompleted.run(id);
  })();
  broadcastOrderUpdate(id);

  const orderForPayment = getOrderById(id);
  const payment = processPayment(orderForPayment, resolvedPayments);
  try {
    await printBill(orderForPayment, payment);
  } catch (err) {
    // The bill's content is already saved to print_jobs (see printBillHtml), so
    // it's recoverable via POST /orders/:id/reprint once a printer is available -
    // no reason a print failure should undo a already-settled payment.
    console.error(`[billing] failed to print bill for order ${id} (payment recorded, order completed):`, (err as Error).message);
  }

  if (order.orderType === 'dine_in') {
    refreshTableStatus(order.tableNumber as number);
  }

  return getOrderById(id);
}

const PRINT_JOB_KINDS = new Set<PrintJobKind>(['kitchen_ticket', 'bill']);

/** Re-sends the previously saved kitchen ticket or bill for an order to the printer. */
export async function reprintOrderDocument(id: number, kind: string): Promise<void> {
  if (!PRINT_JOB_KINDS.has(kind as PrintJobKind)) {
    throw new ValidationError(`kind must be one of ${[...PRINT_JOB_KINDS].join(', ')}`);
  }
  getOrderById(id); // 404s if the order doesn't exist
  await reprintJob(id, kind as PrintJobKind);
}
