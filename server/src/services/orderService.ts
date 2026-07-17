import db from '../db/index.js';
import { ValidationError, NotFoundError, ConflictError } from '../utils/errors.js';
import { markTableBusy, refreshTableStatus } from './tableService.js';
import { processPayment } from './paymentService.js';
import { printBill } from './billingService.js';
import { reprintJob } from './printerService.js';
import type {
  Order,
  OrderItem,
  OrderRequest,
  OrderItemRequest,
  PizzaItemRequest,
  ProductItemRequest,
  OrderType,
  PaymentMethod,
  PizzaGroupId,
  PizzaSizeId,
  ProductCategoryId,
} from '../types/dinapoly-types.js';
import type {
  CategoryRow,
  OrderItemRow,
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
  paymentMethod: PaymentMethod | null;
  tableNumber: number | null;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
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
  `INSERT INTO orders (order_type, payment_method, table_number, customer_name, phone, address, notes, total)
   VALUES (@orderType, @paymentMethod, @tableNumber, @customerName, @phone, @address, @notes, @total)`
);
const insertOrderItem = db.prepare<InsertOrderItemParams>(
  `INSERT INTO order_items
     (order_id, item_type, product_id, product_size_id, product_option_id,
      pizza_group_id, pizza_size_id, pizza_flavor_id, quantity, unit_price, notes)
   VALUES
     (@orderId, @itemType, @productId, @productSizeId, @productOptionId,
      @pizzaGroupId, @pizzaSizeId, @pizzaFlavorId, @quantity, @unitPrice, @notes)`
);
const insertOrderItemFlavor = db.prepare<[number, number]>(
  'INSERT INTO order_item_flavors (order_item_id, flavor_id) VALUES (?, ?)'
);

function isPositiveInt(n: unknown): n is number {
  return Number.isInteger(n) && (n as number) > 0;
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
  flavorIds: number[];
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
  const uniqueFlavors = new Set(item.flavors);
  if (uniqueFlavors.size !== item.flavors.length) {
    throw new ValidationError(`items[${index}]: duplicate flavors are not allowed`);
  }

  // Group is not chosen by the client: it's derived from the flavors picked.
  // A flavor pulls the whole pizza into whichever of its groups prices this
  // size highest (e.g. a single 'special' flavor upgrades an otherwise-classic pizza).
  const candidateGroups = new Map<number, PizzaGroupRow>();
  const flavors = item.flavors.map((flavorKey) => {
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
    return flavor;
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

  const extraCost = flavors.reduce((sum, f) => sum + f.extra_cost, 0);
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
    flavorIds: flavors.map((f) => f.id),
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
    flavorIds: [],
  };
}

function validateOrderRequest(input: unknown): OrderRequest {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('request body must be an object');
  }
  const orderRequest = input as OrderRequest;
  const { orderType, tableNumber, customer, paymentMethod, items } = orderRequest;

  if (!ORDER_TYPES.has(orderType)) {
    throw new ValidationError(`orderType must be one of ${[...ORDER_TYPES].join(', ')}`);
  }

  if (orderType === 'dine_in') {
    if (!isPositiveInt(tableNumber) || tableNumber < 1 || tableNumber > 9) {
      throw new ValidationError('tableNumber is required (1-9) for dine_in orders');
    }
  }
  if (orderType === 'takeaway') {
    if (!customer?.name) throw new ValidationError('customer.name is required for takeaway orders');
  }
  if (orderType === 'delivery') {
    if (!customer?.name) throw new ValidationError('customer.name is required for delivery orders');
    if (!customer?.phone) throw new ValidationError('customer.phone is required for delivery orders');
    if (!customer?.address) throw new ValidationError('customer.address is required for delivery orders');
  }

  if (paymentMethod != null && !PAYMENT_METHODS.has(paymentMethod)) {
    throw new ValidationError(`paymentMethod must be one of ${[...PAYMENT_METHODS].join(', ')}`);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items must be a non-empty array');
  }

  return orderRequest;
}

export function createOrder(input: unknown): Order {
  const orderRequest = validateOrderRequest(input);

  const resolvedItems = orderRequest.items.map((item: OrderItemRequest, index: number) => {
    if (item?.type === 'pizza') return resolvePizzaItem(item, index);
    if (item?.type === 'product') return resolveProductItem(item, index);
    throw new ValidationError(`items[${index}]: type must be 'pizza' or 'product'`);
  });

  const total = resolvedItems.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);

  const orderId = db.transaction(() => {
    const result = insertOrder.run({
      orderType: orderRequest.orderType,
      paymentMethod: orderRequest.paymentMethod ?? null,
      tableNumber: orderRequest.orderType === 'dine_in' ? (orderRequest.tableNumber as number) : null,
      customerName: orderRequest.customer?.name ?? null,
      phone: orderRequest.customer?.phone ?? null,
      address: orderRequest.customer?.address ?? null,
      notes: orderRequest.notes ?? null,
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
      for (const flavorId of item.flavorIds) {
        insertOrderItemFlavor.run(orderItemId, flavorId);
      }
    }

    if (orderRequest.orderType === 'dine_in') {
      markTableBusy(orderRequest.tableNumber as number);
    }

    return newOrderId;
  })();

  return getOrderById(orderId);
}

const getOrderRow = db.prepare<[number], OrderRow>('SELECT * FROM orders WHERE id = ?');
const getOrderItemRows = db.prepare<[number], OrderItemRow>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
const getOrderItemFlavorRows = db.prepare<[number], { key: string }>(
  `SELECT f.key FROM order_item_flavors oif
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
  };

  if (row.item_type === 'pizza') {
    const group = getPizzaGroupById.get(row.pizza_group_id!)!;
    const size = getPizzaSizeById.get(row.pizza_size_id!)!;
    const flavors = getOrderItemFlavorRows.all(row.id).map((f) => f.key);
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

export function getOrderById(id: number): Order {
  const row = getOrderRow.get(id);
  if (!row) throw new NotFoundError(`order ${id} not found`);

  const items = getOrderItemRows.all(id).map(rowToOrderItem);

  return {
    id: row.id,
    orderType: row.order_type,
    status: row.status,
    paymentMethod: row.payment_method,
    tableNumber: row.table_number,
    customerName: row.customer_name,
    phone: row.phone,
    address: row.address,
    total: row.total,
    notes: row.notes,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    items,
  };
}

export function listOrders({ status }: { status?: string } = {}): Order[] {
  const rows = status
    ? db.prepare<[string], { id: number }>('SELECT id FROM orders WHERE status = ? ORDER BY id').all(status)
    : db.prepare<[], { id: number }>('SELECT id FROM orders ORDER BY id').all();
  return rows.map((r) => getOrderById(r.id));
}

const setPaymentMethod = db.prepare<[PaymentMethod, number]>('UPDATE orders SET payment_method = ? WHERE id = ?');
const markCompleted = db.prepare<[number]>(
  `UPDATE orders SET status = 'COMPLETED', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`
);

/**
 * Marks an order COMPLETED: resolves the payment method, processes payment for the
 * order total (COP), prints the bill, then frees the table if it has no other open orders.
 */
export async function completeOrder(id: number, { paymentMethod }: { paymentMethod?: PaymentMethod } = {}): Promise<Order> {
  if (paymentMethod != null && !PAYMENT_METHODS.has(paymentMethod)) {
    throw new ValidationError(`paymentMethod must be one of ${[...PAYMENT_METHODS].join(', ')}`);
  }

  const order = getOrderById(id);

  if (order.status !== 'ACTIVE') {
    throw new ConflictError(`order ${id} cannot be completed from status ${order.status} (must be ACTIVE)`);
  }

  const resolvedMethod = paymentMethod ?? order.paymentMethod;
  if (paymentMethod && paymentMethod !== order.paymentMethod) {
    setPaymentMethod.run(paymentMethod, id);
  }
  const orderForPayment: Order = { ...order, paymentMethod: resolvedMethod };

  const payment = processPayment(orderForPayment);
  await printBill(orderForPayment, payment);

  markCompleted.run(id);

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
