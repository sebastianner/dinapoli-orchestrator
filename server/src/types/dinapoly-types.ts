// ============================================================
// Dinapoli Pizza — shared type definitions
// Matches menu.json structure and the client order payload.
// ============================================================

// ---------- Shared literals ----------

export type OrderType = "dine_in" | "takeaway" | "delivery";

export type PaymentMethod = "cash" | "card" | "transfer";

export type OrderStatus = "PENDING" | "PRINTING" | "ACTIVE" | "COMPLETED";

export type PizzaGroupId = "classic" | "special";

export type PizzaSizeId =
  | "slice"
  | "personal"
  | "small"
  | "medium"
  | "large"
  | "xlarge";

export type ProductCategoryId =
  | "appetizers"
  | "gratinados"
  | "calzones"
  | "pastas"
  | "lasagnas"
  | "drinks"
  | "desserts";

// ============================================================
// MENU (shape of menu.json)
// ============================================================

export interface Menu {
  menu: MenuCategory[];
}

/** A top-level menu category is either the pizzas category (groups) or a product category. */
export type MenuCategory = PizzaCategory | ProductCategory;

export interface PizzaCategory {
  id: "pizzas";
  name: string;
  groups: PizzaGroup[];
}

export interface PizzaGroup {
  id: PizzaGroupId;
  name: string;
  sizes: PizzaSize[];
  flavors: PizzaFlavor[];
}

export interface PizzaSize {
  id: PizzaSizeId;
  name: string;
  slices: number;
  maxFlavors: number;
  /** Absent for 'slice' in the current menu data. */
  price?: number;
}

export interface PizzaFlavor {
  id: string;
  name: string;
  description: string;
}

export interface ProductCategory {
  id: ProductCategoryId;
  name: string;
  products: Product[];
}

export interface Product {
  id: string;
  name: string;
  /** Absent when the product is priced per size (e.g. calzone). */
  price?: number;
  /** Present when the product comes in sizes with their own price (calzone). */
  sizes?: ProductSize[];
  /** Selectable variants that don't affect price (drinks). */
  options?: ProductOption[];
  /** True when the product takes a pizza flavor (gratinados, calzones). */
  pizzaFlavor?: boolean;
}

export interface ProductOption {
  id: string;
  name: string;
}

export interface ProductSize {
  id: string;
  name: string;
  price: number;
}

// ============================================================
// EMPLOYEES
// Identification only, no auth: enough to attribute an order to
// whoever placed it. Removal is a soft delete (isActive: false)
// so past orders keep a valid employeeId.
// ============================================================

export interface Employee {
  id: number;
  name: string;
  pictureUrl: string | null;
  isActive: boolean;
}

// ============================================================
// ORDER REQUEST (client -> server payload)
// Client sends references and quantities only. Prices are
// always resolved server-side from the menu.
// ============================================================

export interface OrderRequest {
  orderType: OrderType;
  /** Optional. When present, must be an active employee's id. */
  employeeId?: number;
  /** Required when orderType = 'dine_in'. 1-9. */
  tableNumber?: number;
  /** Required for 'takeaway' (name) and 'delivery' (name, phone, address). */
  customer?: CustomerInfo;
  notes?: string;
  items: OrderItemRequest[];
}

export interface CustomerInfo {
  name: string;
  phone?: string;
  address?: string;
}

export type OrderItemRequest = PizzaItemRequest | ProductItemRequest;

export interface PizzaFlavorSelection {
  /** Flavor id. */
  flavor: string;
  /** This flavor's share of the pizza, percent, 1-100. */
  portion: number;
}

export interface PizzaItemRequest {
  type: "pizza";
  size: PizzaSizeId;
  /**
   * 1..maxFlavors selections; portions must sum to exactly 100. The group is
   * not chosen by the client: the server derives it from the flavors picked
   * (mixing in any 'special' flavor upgrades the whole pizza to the special
   * price for this size, regardless of that flavor's portion).
   */
  flavors: PizzaFlavorSelection[];
  quantity: number;
  notes?: string;
}

export interface ProductItemRequest {
  type: "product";
  category: ProductCategoryId;
  /** Product id within that category. */
  product: string;
  /** id of one of the product's options (drinks), e.g. 'coca_cola'. */
  option?: string;
  /** ProductSize id when the product is priced per size (calzone). */
  size?: string;
  /** Pizza flavor id when the product has pizzaFlavor: true. */
  pizzaFlavor?: string;
  quantity: number;
  notes?: string;
}

// ============================================================
// ORDER (server-side representation, mirrors the DB schema)
// ============================================================

export interface Order {
  id: number;
  orderType: OrderType;
  status: OrderStatus;
  /** The employee who placed the order, if any. */
  employeeId: number | null;
  employeeName: string | null;
  tableNumber: number | null;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  /** Integer COP. Computed server-side, sum of items only (excludes tip). */
  total: number;
  /**
   * Integer COP. Always 0 until the order is COMPLETED - there's nowhere to
   * declare a tip before a payment method is chosen. Set for the first and
   * only time via POST /api/orders/:id/complete's `payments[].tipAmount`,
   * and derived from summing those rows afterward (see getOrderById).
   */
  tip: number;
  /** Integer COP. Delivery orders only. Same lifecycle as `tip`, set via `payments[].deliveryFee` at completion. */
  deliveryFee: number;
  /**
   * Integer COP. Same lifecycle as `tip`, set via `payments[].discount` at
   * completion. Reduces what the customer actually pays, but `total`/item
   * prices are never decreased by it - see OrderPayment.amount for why.
   */
  discount: number;
  notes: string | null;
  createdAt: string; // ISO / SQLite datetime
  completedAt: string | null;
  items: OrderItem[];
  /**
   * How the order was actually settled. Empty until completion; POST
   * /api/orders/:id/complete writes one row per method used (a plain
   * single-method payment is just one entry). Amounts always sum to
   * `total + tip + deliveryFee`.
   */
  payments: OrderPayment[];
}

export interface OrderPayment {
  id: number;
  orderId: number;
  method: PaymentMethod;
  /**
   * Integer COP. Total charged via this method, tip and delivery fee
   * included - always the GROSS amount, before this split's `discount`. It's
   * never reduced to reflect a discount, so the original pre-discount price
   * stays on record; the actual cash collected is `amount - discount`,
   * derived whenever needed rather than stored.
   */
  amount: number;
  /** Integer COP. The slice of `amount` that's tip rather than sales; 0..amount. */
  tipAmount: number;
  /** Integer COP. The slice of `amount` that's delivery fee rather than sales; 0..amount. */
  deliveryFee: number;
  /** Integer COP. The slice of `amount` this split's discount accounts for; 0..amount. */
  discount: number;
  createdAt: string;
}

export interface OrderItem {
  id: number;
  orderId: number;
  /** Null when the line is a pizza. */
  menuItemRef: ProductRef | null;
  /** Null when the line is not a pizza. */
  pizzaRef: PizzaRef | null;
  quantity: number;
  /** Price snapshot at order time, integer COP. */
  unitPrice: number;
  notes: string | null;
  /** Null until the queue worker includes this item in a kitchen ticket (original or addendum). */
  printedAt: string | null;
}

export interface ProductRef {
  category: ProductCategoryId;
  product: string;
  option?: string;
  size?: string;
  pizzaFlavor?: string;
}

export interface PizzaRef {
  group: PizzaGroupId;
  size: PizzaSizeId;
  flavors: PizzaFlavorSelection[];
}

// ============================================================
// CASH FLOW (server-side representation, mirrors the DB schema)
// ============================================================

/**
 * One register period, one per business day (Bogota local date). A new
 * period opens automatically the moment the latest one isn't from today
 * (checked at server boot and lazily on any cash-flow access) - bookkeeping
 * only, not the End-of-Day Closing itself (sales report, printed receipt;
 * see ClosingReport below), which stays a manual staff action. Old periods
 * are kept forever; "current" is simply the most recently created one.
 */
export interface CashFlowDay {
  id: number;
  /** YYYY-MM-DD, the business day this period belongs to. */
  date: string;
  cashInRegister: number;
  /** Running total of all expenses recorded against this period. */
  expenses: number;
  createdAt: string;
}

export interface CashExpense {
  id: number;
  cashFlowId: number;
  amount: number;
  justification: string;
  createdAt: string;
}

// ============================================================
// END-OF-DAY CLOSING (server-side representation, mirrors the DB schema)
// ============================================================

/**
 * A generated, printed snapshot of one business day's sales. Always a manual
 * staff action (POST /api/end-of-day/close) - unlike CashFlowDay's automatic
 * per-day rotation, nothing creates this except that explicit request, and
 * nothing stops calling it more than once for the same day (e.g. reprinting
 * after a paper jam); every call appends a new row rather than overwriting,
 * so history is never lost.
 */
export interface ClosingReport {
  id: number;
  /** YYYY-MM-DD, the business day this report covers. */
  date: string;
  orderCount: number;
  /** COP. Sum of (order.total + order.deliveryFee) for delivery orders. Tips excluded. */
  deliverySales: number;
  /** COP. Sum of (order.total + order.deliveryFee) for dine_in/takeaway orders. Tips excluded. */
  dineInTakeawaySales: number;
  /** COP. Sum of (order.total + order.deliveryFee), grouped by paymentMethod. Tips excluded. */
  cashSales: number;
  cardSales: number;
  transferSales: number;
  /** COP. Grand total sales: deliverySales + dineInTakeawaySales. */
  totalSales: number;
  /** COP. Total cash_expenses recorded against this business day. */
  totalExpenses: number;
  createdAt: string;
}

// ---------- Type guards ----------

export function isPizzaCategory(c: MenuCategory): c is PizzaCategory {
  return c.id === "pizzas";
}

export function isPizzaItem(i: OrderItemRequest): i is PizzaItemRequest {
  return i.type === "pizza";
}
