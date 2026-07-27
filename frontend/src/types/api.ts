// ============================================================
// Shared types mirroring the Dinapoli backend's API contracts.
// Kept in sync manually with server/src/types/dinapoly-types.ts.
// ============================================================

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';

export type PaymentMethod = 'cash' | 'card' | 'transfer';

export type OrderStatus = 'PENDING' | 'PRINTING' | 'ACTIVE' | 'COMPLETED';

export type PizzaGroupId = 'classic' | 'special';

export type PizzaSizeId = 'slice' | 'personal' | 'small' | 'medium' | 'large' | 'xlarge';

export type ProductCategoryId =
  | 'appetizers'
  | 'gratinados'
  | 'calzones'
  | 'pastas'
  | 'lasagnas'
  | 'drinks'
  | 'desserts';

// ---------- Menu ----------

export interface Menu {
  menu: MenuCategory[];
}

export type MenuCategory = PizzaCategory | ProductCategory;

export interface PizzaCategory {
  id: 'pizzas';
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
  description?: string;
  /** Absent when the product is priced per size (e.g. calzone). */
  price?: number;
  sizes?: ProductSize[];
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

export function isPizzaCategory(c: MenuCategory): c is PizzaCategory {
  return c.id === 'pizzas';
}

// ---------- Employees ----------

/** 'admin' employees log in with a password; 'staff' log in by picking their name, no password. */
export type EmployeeRole = 'staff' | 'admin';

export interface Employee {
  id: number;
  name: string;
  pictureUrl: string | null;
  isActive: boolean;
  role: EmployeeRole;
}

// ---------- Tables ----------

export interface RestaurantTableSummary {
  number: number;
  status: 'free' | 'busy';
}

// ---------- Orders ----------

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
  type: 'pizza';
  size: PizzaSizeId;
  flavors: PizzaFlavorSelection[];
  quantity: number;
  notes?: string;
}

export interface ProductItemRequest {
  type: 'product';
  category: ProductCategoryId;
  product: string;
  option?: string;
  size?: string;
  pizzaFlavor?: string;
  quantity: number;
  notes?: string;
}

export function isPizzaItem(i: OrderItemRequest): i is PizzaItemRequest {
  return i.type === 'pizza';
}

/** 'duo': 2 products (personal pizza/lasagna/pasta/gratin) for a flat $37,000. 'pizza_xl': XL pizza + free soda + free bread for $80,000. */
export type PromoType = 'duo' | 'pizza_xl';

export interface OrderRequest {
  orderType: OrderType;
  /** Optional. When present, must be an active employee's id. */
  employeeId?: number;
  /** Required when orderType = 'dine_in'. 1-9. */
  tableNumber?: number;
  /** Required for 'takeaway' (name) and 'delivery' (name, phone, address). */
  customer?: CustomerInfo;
  notes?: string;
  /** Optional. When set, `items` must exactly match that promo's required composition (server-validated). */
  promoType?: PromoType;
  items: OrderItemRequest[];
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

export interface OrderItem {
  id: number;
  orderId: number;
  menuItemRef: ProductRef | null;
  pizzaRef: PizzaRef | null;
  quantity: number;
  unitPrice: number;
  notes: string | null;
  printedAt: string | null;
}

export interface OrderPayment {
  id: number;
  orderId: number;
  method: PaymentMethod;
  /** Integer COP. Total charged via this method, tip and delivery fee included - the GROSS amount, before this split's own discount. Named distinctly from Order.total (items only) so the two can't be confused. */
  grossAmount: number;
  /** Integer COP. The slice of `grossAmount` that's tip rather than sales; 0..grossAmount. */
  tipAmount: number;
  /** Integer COP. The slice of `grossAmount` that's delivery fee rather than sales; 0..grossAmount. */
  deliveryFee: number;
  /** Integer COP. `grossAmount - tipAmount - deliveryFee` - the products-only slice, server-computed. SUM(netAmount) across an order's payments equals order.total exactly. */
  netAmount: number;
  /** Integer COP. The slice of `netAmount` this split's discount accounts for (discounts apply to products, not tip/delivery fee); actual cash collected is `grossAmount - discount`. */
  discount: number;
  createdAt: string;
}

export interface PaymentSplitRequest {
  method: PaymentMethod;
  grossAmount: number;
  tipAmount?: number;
  deliveryFee?: number;
  discount?: number;
}

export interface Order {
  id: number;
  orderType: OrderType;
  status: OrderStatus;
  employeeId: number | null;
  employeeName: string | null;
  tableNumber: number | null;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  /** Integer COP. Sum of items only (excludes tip/deliveryFee/discount) - see grandTotal for the "everything included" figure. */
  total: number;
  tip: number;
  deliveryFee: number;
  discount: number;
  /** Integer COP. `total + tip + deliveryFee` - the one canonical name for "everything owed/paid, before discount". */
  grandTotal: number;
  /** Null for the vast majority of orders. Set once at creation, never changed. */
  promoType: PromoType | null;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
  items: OrderItem[];
  payments: OrderPayment[];
}

// ---------- Cash flow ----------

export interface CashFlowDay {
  id: number;
  date: string;
  cashInRegister: number;
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

export interface CashRegisterSettings {
  defaultOpeningCash: number;
}

// ---------- End of day ----------

export interface ClosingReport {
  id: number;
  date: string;
  orderCount: number;
  deliverySales: number;
  dineInTakeawaySales: number;
  cashSales: number;
  cardSales: number;
  transferSales: number;
  /** Tips and discounts excluded - see tips/discounts below. */
  totalSales: number;
  tips: number;
  discounts: number;
  totalExpenses: number;
  createdAt: string;
}

// ---------- WebSocket order intake protocol ----------

export type OrderSocketServerMessage =
  | { type: 'connected'; message: string }
  | { type: 'order_created'; order: Order }
  | { type: 'error'; message: string };
