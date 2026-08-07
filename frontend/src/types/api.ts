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
  /** Index into OrderRequest.promos - which promo instance this item is part of, if any (see applyPromoPricingPreview/useOrderStore.addPromoItem). Lets a promo share an order with extra, normally-priced items, and lets several promos share one order. */
  promoGroup?: number;
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
  /** Index into OrderRequest.promos - which promo instance this item is part of, if any (see applyPromoPricingPreview/useOrderStore.addPromoItem). Lets a promo share an order with extra, normally-priced items, and lets several promos share one order. */
  promoGroup?: number;
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
  /** Optional, one entry per promo instance on this order (an order can carry several). Each items[].promoGroup is an index into this array; those items must exactly match that entry's promo composition (server-validated). */
  promos?: PromoType[];
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
  /** Index into the order's `promos` array - which promo instance this line is part of, or null for a normally-priced item. */
  promoGroup: number | null;
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
  /** Empty for the vast majority of orders. One entry per promo instance on this order (an order can carry several) - set once at creation, never changed. `group` is the index items[].promoGroup points at for items belonging to that instance. */
  promos: { group: number; type: PromoType; basePrice: number }[];
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

export interface ClosingReportExpenseDetail {
  amount: number;
  justification: string;
  createdAt: string;
}

export interface ClosingReport {
  id: number;
  date: string;
  orderCount: number;
  deliverySales: number;
  dineInTakeawaySales: number;
  /** COP. Discounts subtracted; cash tips excluded, card/transfer/rappi tips included as income (see tips below). */
  cashSales: number;
  cardSales: number;
  transferSales: number;
  rappiSales: number;
  /** COP. The real income sold - discounts subtracted, cash tips excluded, card/transfer/rappi tips included. */
  totalSales: number;
  /** COP. Total tips across all payment methods (informational only - card/transfer/rappi tips are already folded into totalSales via their method's sales figure; cash tips are not part of totalSales at all). */
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
  /** Itemized cash_expenses rows for this business day, frozen at closing time. */
  expensesDetail: ClosingReportExpenseDetail[];
  /** COP. Snapshot of that day's cash_flow.cash_in_register at closing time - kept only as a historical record, NOT part of "Efectivo final en caja" (see cashSales below). */
  cashInRegister: number;
  /** The exact plain-text thermal-receipt content generated at closing time - what a reprint re-sends verbatim. */
  content: string;
  createdAt: string;
}

// ---------- Analytics (/dashboard/analytics, analyticsService on the server) ----------
// Every figure below is computed live over a date range, never read from
// ClosingReport - see server/src/services/analyticsService.ts. Sales figures
// use the same formula as ClosingReport.totalSales above: discounts always
// subtracted, cash tips excluded, card/transfer/rappi tips included as income.

export type AnalyticsRange = 'today' | 'week' | 'month' | 'custom';

export interface SalesSummary {
  /** COP. Same formula as ClosingReport.totalSales - the real income for the selected range. */
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
  /** COP. Same formula as SalesSummary.totalSales. */
  totalSales: number;
  orderCount: number;
}

export interface PaymentMethodBreakdown {
  method: PaymentMethod;
  /** COP. Same formula as SalesSummary.totalSales - for 'card'/'transfer'/'rappi' this already includes their tips as income. */
  sales: number;
}

export interface OrderTypeBreakdown {
  orderType: OrderType;
  /** COP. Same formula as SalesSummary.totalSales. */
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
  /** "{category} - {product}" (plus " - {size}" when sized), or for pizzas just "Pizza {size}" - flavor is deliberately not part of this name at all (see FlavorRanking below instead), so single-flavor and split/mitad-y-mitad pizzas of the same size share one row. */
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

/** The three categories whose items carry a pizza flavor - the only ones useAnalyticsFlavors/getFlavors can filter to. */
export type FlavorAnalyticsCategory = 'pizzas' | 'gratinados' | 'calzones';

export interface FlavorRanking {
  flavor: string;
  /** Fractional for pizza flavors (portion-weighted - a 50/50 split pizza contributes 0.5 to each flavor). Always whole for gratinados/calzones. */
  quantity: number;
  /** COP. Same portion-weighting as quantity. */
  revenue: number;
}

export interface FlavorAnalytics {
  /** Sorted by revenue descending. Combines every category unless filtered to one. */
  flavors: FlavorRanking[];
}

export interface CustomerSpend {
  id: number;
  name: string;
  phone: string | null;
  orderCount: number;
  /** COP. Same formula as SalesSummary.totalSales. */
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
  /** COP. Same formula as SalesSummary.totalSales. */
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
