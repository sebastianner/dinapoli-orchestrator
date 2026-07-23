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

export interface Employee {
  id: number;
  name: string;
  pictureUrl: string | null;
  isActive: boolean;
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

export interface PizzaItemRequest {
  type: 'pizza';
  size: PizzaSizeId;
  flavors: string[];
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

export interface OrderRequest {
  orderType: OrderType;
  /** Optional. When present, must be an active employee's id. */
  employeeId?: number;
  /** Required when orderType = 'dine_in'. 1-9. */
  tableNumber?: number;
  /** Required for 'takeaway' (name) and 'delivery' (name, phone, address). */
  customer?: CustomerInfo;
  /** A declared single method of intent, not a settlement. */
  paymentMethod?: PaymentMethod;
  notes?: string;
  tip?: number;
  deliveryFee?: number;
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
  flavors: string[];
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
  /** Integer COP. Total charged via this method, tip included. */
  amount: number;
  /** Integer COP. The slice of `amount` that's tip rather than sales; 0..amount. */
  tipAmount: number;
  createdAt: string;
}

export interface PaymentSplitRequest {
  method: PaymentMethod;
  amount: number;
  tipAmount?: number;
}

export interface Order {
  id: number;
  orderType: OrderType;
  status: OrderStatus;
  employeeId: number | null;
  employeeName: string | null;
  paymentMethod: PaymentMethod | null;
  tableNumber: number | null;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  /** Integer COP. Sum of items only (excludes tip and delivery fee). */
  total: number;
  tip: number;
  deliveryFee: number;
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
  totalSales: number;
  totalExpenses: number;
  createdAt: string;
}

// ---------- WebSocket order intake protocol ----------

export type OrderSocketServerMessage =
  | { type: 'connected'; message: string }
  | { type: 'order_created'; order: Order }
  | { type: 'error'; message: string };
