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
  /** False for a sold-out product - still present (not filtered out of the menu) so it can render as a disabled card instead of disappearing. */
  isAvailable: boolean;
  /** Absent when the product is priced per size (e.g. calzone). */
  price?: number;
  sizes?: ProductSize[];
  options?: ProductOption[];
  /** True when the product takes a pizza flavor (gratinados, calzones). */
  pizzaFlavor?: boolean;
}

/** A Product plus which category it lives in - /menu/search results span every category, unlike ProductCategory.products which are already grouped. */
export interface ProductSearchResult extends Product {
  categoryId: ProductCategoryId;
}

/** The full row behind a menu Product, for /dashboard/menu-settings - unlike Product (only ever the currently-available subset), this carries the numeric id updates/deletes target and isAvailable regardless of value. */
export interface AdminProduct {
  id: number;
  categoryId: ProductCategoryId;
  key: string;
  name: string;
  description: string | null;
  /** Null when priced per size (e.g. calzone) - see sizes. */
  price: number | null;
  isAvailable: boolean;
  sizes: ProductSize[];
  options: ProductOption[];
  pizzaFlavor: boolean;
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

// ---------- Pizza admin (/dashboard/menu-settings, /api/pizza-admin) ----------

export interface AdminPizzaGroupSize {
  id: PizzaSizeId;
  name: string;
  slices: number;
  maxFlavors: number;
  /** Null for a size not flat-priced in this group (e.g. 'slice', priced via portion splitting instead). */
  price: number | null;
}

export interface AdminPizzaGroup {
  id: PizzaGroupId;
  name: string;
  sizes: AdminPizzaGroupSize[];
}

/** A flavor can be offered under more than one group. */
export interface AdminPizzaFlavor {
  id: number;
  key: string;
  name: string;
  description: string | null;
  groupIds: PizzaGroupId[];
}

export interface PizzaAdminData {
  groups: AdminPizzaGroup[];
  flavors: AdminPizzaFlavor[];
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

// ---------- Customers & locations ----------

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  addresses: CustomerAddress[];
}

export type PropertyType = 'HOUSE' | 'APARTMENT' | 'OFFICE' | 'BUILDING' | 'OTHER';

export interface CustomerAddress {
  id: number;
  customerId: number;
  streetAddress: string;
  /** Free-text second line (e.g. "casa 5, interior 2"), independent of propertyType. */
  addressLine2: string | null;
  propertyType: PropertyType;
  neighborhoodId: number;
  neighborhoodName: string;
  cityId: number;
  cityName: string;
  /** Integer COP. The neighborhood's delivery fee - handy for suggesting a delivery order's fee at checkout without a second lookup. */
  deliveryFee: number;
  apartmentNumber: string | null;
  tower: string | null;
  buildingName: string | null;
  reference: string | null;
  latitude: number | null;
  longitude: number | null;
  googlePlaceId: string | null;
  formattedAddress: string | null;
}

export interface City {
  id: number;
  name: string;
  department: string | null;
  country: string;
}

export interface Neighborhood {
  id: number;
  name: string;
  cityId: number;
  deliveryFee: number;
}

// ---------- Orders ----------

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

/** 'duo': 2 products (personal pizza/lasagna/pasta/gratin) for a flat price. 'pizza_xl': XL pizza + free soda + free bread for a flat price. Prices are admin-editable - see PromoSettings. */
export type PromoType = 'duo' | 'pizza_xl';

/** Admin-editable flat pricing for a promo (see /dashboard/promos). */
export interface PromoSettings {
  promoType: PromoType;
  price: number;
  /** COP. 'pizza_xl' only - the extra charge for choosing Coca-Cola/Quatro as the promo's soda. Always 0 for 'duo'. */
  sodaSurcharge: number;
}

export interface OrderRequest {
  orderType: OrderType;
  /** Required - must be an active employee's id. The app enforces that one is always selected before any order can be placed (see __root.tsx). */
  employeeId: number;
  /** Required when orderType = 'dine_in'. 1-9. */
  tableNumber?: number;
  /** Required for 'takeaway' and 'delivery'; optional for 'dine_in'. */
  customerId?: number;
  /** Required for 'delivery' only; must be one of customerId's own addresses. */
  customerAddressId?: number;
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
  customerId: number | null;
  customerAddressId: number | null;
  /** Derived server-side from customerId/customerAddressId. */
  customerName: string | null;
  phone: string | null;
  /** Formatted delivery address (street + building/tower/apt + neighborhood + city), delivery orders only. */
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
  /** Total quantity of items across every completed order that day (a pizza with quantity 2 counts as 2). */
  itemsSold: number;
  /** Distinct customers served - the same customer ordering twice still counts once. */
  customersServed: number;
  deliveryOrderCount: number;
  dineInOrderCount: number;
  takeawayOrderCount: number;
  totalExpenses: number;
  createdAt: string;
}

// ---------- WebSocket order intake protocol ----------

export type OrderSocketServerMessage =
  | { type: 'connected'; message: string }
  | { type: 'order_created'; order: Order }
  | { type: 'error'; message: string }
  | { type: 'order_updated'; orderId: number }
  | { type: 'tables_updated' };
