// ============================================================
// Shared types mirroring the Dinapoli backend's API contracts.
// Kept in sync manually with server/src/types/dinapoly-types.ts.
// ============================================================

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'rappi';

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
  /** False for a sold-out flavor - still present (not filtered out of the menu) so it can render disabled instead of disappearing, same as Product.isAvailable. */
  isAvailable: boolean;
  /**
   * Surcharge this flavor adds on top of the group+size price, integer COP,
   * usually 0. Charged pro-rata by portion on a pizza (half a premium flavor
   * adds half its surcharge) and whole on a product that takes a pizza flavor.
   * Mirrored in lib/pricing so the cart quotes what the server charges.
   */
  extraCost: number;
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
  /** Selectable flavors that don't affect price (drinks) - absent/empty means this product doesn't ask for one (e.g. Coca-Cola 3L). */
  drinkFlavors?: DrinkFlavor[];
  /** True when the product takes a pizza flavor (gratinados, calzones). */
  pizzaFlavor?: boolean;
}

/** A Product plus which category it lives in - /menu/search results span every category, unlike ProductCategory.products which are already grouped. */
export interface ProductSearchResult extends Product {
  categoryId: ProductCategoryId;
}

/** A PizzaFlavor plus which group(s) (classic/special) it belongs to - /menu/flavors/search results span both groups, unlike PizzaGroup.flavors which are already scoped to one. */
export interface PizzaFlavorSearchResult extends PizzaFlavor {
  groupIds: PizzaGroupId[];
}

/** The full row behind a menu Product, for /ajustes/menu-settings - unlike Product (only ever the currently-available subset), this carries the numeric id updates/deletes target and isAvailable regardless of value. */
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
  drinkFlavors: DrinkFlavor[];
  pizzaFlavor: boolean;
}

export interface DrinkFlavor {
  id: string;
  name: string;
}

/** A drink flavor as seen from the admin menu-settings flavor library (/ajustes/menu-settings, see AddProductModal/DrinkFlavorsModal) - id here is numeric (the DB row), unlike DrinkFlavor.id which is the string key. */
export interface AdminDrinkFlavor {
  id: number;
  key: string;
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

// ---------- Pizza admin (/ajustes/menu-settings, /api/pizza-admin) ----------

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
  isAvailable: boolean;
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
  /** True for an item that's part of the order's promoType composition - lets a promo share an order with extra, normally-priced items (see applyPromoPricingPreview/useOrderStore.addPromoItem). */
  promoItem?: boolean;
}

export interface ProductItemRequest {
  type: 'product';
  category: ProductCategoryId;
  product: string;
  drinkFlavor?: string;
  size?: string;
  pizzaFlavor?: string;
  quantity: number;
  notes?: string;
  /** True for an item that's part of the order's promoType composition - lets a promo share an order with extra, normally-priced items (see applyPromoPricingPreview/useOrderStore.addPromoItem). */
  promoItem?: boolean;
}

export function isPizzaItem(i: OrderItemRequest): i is PizzaItemRequest {
  return i.type === 'pizza';
}

/** 'duo': 2 products (personal pizza/lasagna/pasta/gratin) for a flat price. 'pizza_xl': XL pizza + free soda + free bread for a flat price. Prices are admin-editable - see PromoSettings. */
export type PromoType = 'duo' | 'pizza_xl';

/** Admin-editable flat pricing for a promo (see /ajustes/promos). */
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
  drinkFlavor?: string;
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
  /** True once a bill/invoice has been generated and saved for this order (see orderService.printInvoice server-side). Drives the Order Overview button's preview-vs-checkout state and Order History's reprint-vs-generate branch. */
  hasBill: boolean;
}

// ---------- Cash flow ----------

export interface CashFlowDay {
  id: number;
  date: string;
  cashInRegister: number;
  expenses: number;
  createdAt: string;
  /** COP. Sum of cash payments across today's COMPLETED orders so far - add to cashInRegister for the drawer's expected current cash. Only present on the *current* period (useCurrentCashFlow), absent from useCashFlowHistory's rows. */
  cashSalesToday?: number;
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
  /** COP. Net of discounts already (real cash collected via this method) and tips (see tips below). */
  cashSales: number;
  cardSales: number;
  transferSales: number;
  rappiSales: number;
  /** COP. Net of discounts already, tips excluded (see tips below) - the real money sold. */
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
  /** COP. Snapshot of that day's cash_flow.cash_in_register at closing time - add cashSales for "Efectivo final en caja", the expected final cash count. */
  cashInRegister: number;
  /** The exact plain-text thermal-receipt content generated at closing time - what a reprint re-sends verbatim. */
  content: string;
  createdAt: string;
}

// ---------- Analytics (/dashboard/analytics, analyticsService on the server) ----------
// Every figure below is computed live over a date range, never read from
// ClosingReport - see server/src/services/analyticsService.ts. Sales figures
// are net of tips and discounts (unlike ClosingReport's stale "tips excluded"
// wording above, which predates that fix - see cashSales/totalSales here).

export type AnalyticsRange = 'today' | 'week' | 'month' | 'custom';

export interface SalesSummary {
  /** COP. Net of tips and discounts - the real money sold in the selected range. */
  totalSales: number;
  /** Percent change vs. the immediately preceding period of equal length. null when the prior period had zero sales (no baseline to compare against). */
  totalSalesGrowthPct: number | null;
  orderCount: number;
  orderCountGrowthPct: number | null;
  /** COP. totalSales / orderCount, 0 when orderCount is 0. */
  avgOrderValue: number;
  avgOrderValueGrowthPct: number | null;
  /** Sum of item quantities / orderCount, 0 when orderCount is 0. */
  itemsPerOrder: number;
  /** Distinct customers across the range's completed orders - the same customer ordering twice still counts once. */
  customersServed: number;
  customersServedGrowthPct: number | null;
}

export interface SalesTrendPoint {
  /** Bucket key: 'HH' (00-23) when the range spans a single day, otherwise 'YYYY-MM-DD'. */
  date: string;
  /** Human-readable label for the same bucket, e.g. '14:00' or 'lun 21'. */
  bucketLabel: string;
  /** COP. Net of tips and discounts, same formula as SalesSummary.totalSales. */
  totalSales: number;
  orderCount: number;
}

export interface PaymentMethodBreakdown {
  method: PaymentMethod;
  /** COP. Net of tips and discounts. */
  sales: number;
}

export interface OrderTypeBreakdown {
  orderType: OrderType;
  /** COP. Net of tips and discounts. */
  sales: number;
  orderCount: number;
}

export interface SalesBreakdown {
  /** Always all 3 methods, 0 for any unused in the range. */
  paymentMethods: PaymentMethodBreakdown[];
  /** Always all 3 order types, 0 for any unused in the range. */
  orderTypes: OrderTypeBreakdown[];
}

export interface HeatmapCell {
  /** 0 (Sunday) - 6 (Saturday). */
  dow: number;
  /** 0-23, Bogota local hour. */
  hour: number;
  orderCount: number;
}

export interface ProductRanking {
  /** Product name, or for pizzas "{flavor} {size}" (single-flavor) / "Pizza mitad y mitad {size}" (split across >1 flavor - not fractionally attributed per flavor). */
  name: string;
  category: string;
  quantity: number;
  /** COP. */
  revenue: number;
}

export interface CategoryRevenue {
  /** A real category name, or the synthetic "Pizzas" bucket - pizzas aren't modeled under any category. */
  category: string;
  quantity: number;
  /** COP. */
  revenue: number;
}

export interface ProductsAnalytics {
  /** Sorted by revenue descending - slice/re-sort client-side for top/bottom-N by either metric. */
  products: ProductRanking[];
  categories: CategoryRevenue[];
}

export interface CustomerSpend {
  id: number;
  name: string;
  phone: string | null;
  orderCount: number;
  /** COP. Net of tips and discounts. */
  spend: number;
}

export interface CustomerGrowth {
  newCustomers: number;
  returningCustomers: number;
}

export interface CustomersAnalytics {
  /** Top spenders in the range, capped server-side. */
  topCustomers: CustomerSpend[];
  growth: CustomerGrowth;
}

export interface EmployeePerformance {
  id: number;
  name: string;
  isActive: boolean;
  orderCount: number;
  /** COP. Net of tips and discounts. */
  sales: number;
}

export interface PromoUsageSummary {
  promoCounts: { promoType: PromoType; orderCount: number }[];
  /** COP. */
  totalDiscount: number;
  totalOrders: number;
  ordersWithDiscount: number;
  /** ordersWithDiscount / totalOrders * 100, 0 when totalOrders is 0. */
  discountedOrderPct: number;
}

// ---------- WebSocket order intake protocol ----------

export type OrderSocketServerMessage =
  | { type: 'connected'; message: string }
  | { type: 'order_created'; order: Order }
  | { type: 'error'; message: string }
  | { type: 'order_updated'; orderId: number }
  | { type: 'tables_updated' };
