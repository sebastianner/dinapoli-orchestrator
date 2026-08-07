// ============================================================
// Dinapoli Pizza — shared type definitions
// Matches menu.json structure and the client order payload.
// ============================================================

// ---------- Shared literals ----------

export type OrderType = "dine_in" | "takeaway" | "delivery";

export type PaymentMethod = "cash" | "card" | "transfer" | "rappi";

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
  /** False for a sold-out flavor - still present (not filtered out of the menu) so it can render disabled instead of disappearing, same as Product.isAvailable. */
  isAvailable: boolean;
  /**
   * Surcharge this flavor adds on top of the group+size price, integer COP,
   * usually 0. On a pizza it is charged pro-rata by portion (half a premium
   * flavor adds half its surcharge - see orderService.resolvePizzaItem); on a
   * product that takes a pizza flavor (gratinado, calzone) it is added whole.
   *
   * Exposed because the server charges it and the cart has to be able to show
   * the same number. It used to be server-only, which meant that the moment a
   * non-zero value existed the cart quoted one price and the bill charged
   * another, with no way for the frontend to tell.
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
  /** False for a sold-out product - still returned (not filtered out) so it can render as a disabled card instead of just disappearing; the server still rejects ordering it either way (see orderService.resolveProductItem). */
  isAvailable: boolean;
  /** Absent when the product is priced per size (e.g. calzone). */
  price?: number;
  /** Present when the product comes in sizes with their own price (calzone). */
  sizes?: ProductSize[];
  /** Selectable flavors that don't affect price (drinks) - absent/empty means this product doesn't ask for one (e.g. Coca-Cola 3L). */
  drinkFlavors?: DrinkFlavor[];
  /** True when the product takes a pizza flavor (gratinados, calzones). */
  pizzaFlavor?: boolean;
}

/** A Product plus which category it lives in - menuService.searchProducts results span every category, unlike ProductCategory.products which are already grouped. */
export interface ProductSearchResult extends Product {
  categoryId: ProductCategoryId;
}

/** A PizzaFlavor plus which group(s) (classic/special) it belongs to - menuService.searchPizzaFlavors results span both groups, unlike PizzaGroup.flavors which are already scoped to one. */
export interface PizzaFlavorSearchResult extends PizzaFlavor {
  groupIds: PizzaGroupId[];
}

export interface DrinkFlavor {
  id: string;
  name: string;
}

export interface ProductSize {
  id: string;
  name: string;
  price: number;
}

/**
 * The full row behind a menu Product, for the admin settings dashboard -
 * unlike Product (customer/staff-facing, only ever the currently-available
 * subset, keyed by `key`), this carries the numeric `id` updates/deletes
 * target, `isAvailable` regardless of value, and `categoryId` since admin
 * listings aren't pre-grouped like getMenu's response.
 */
export interface AdminProduct {
  id: number;
  categoryId: ProductCategoryId;
  key: string;
  name: string;
  description: string | null;
  /** Null when priced per size (e.g. calzone) - see `sizes`. */
  price: number | null;
  isAvailable: boolean;
  sizes: ProductSize[];
  drinkFlavors: DrinkFlavor[];
  pizzaFlavor: boolean;
}

/** A drink flavor as seen from the admin menu-settings library - id/key/name, plus which products currently offer it. Not otherwise exposed to the public /menu endpoint (see Product.drinkFlavors for that shape). */
export interface AdminDrinkFlavor {
  id: number;
  key: string;
  name: string;
}

// ============================================================
// PIZZA ADMIN (editing groups/sizes/flavors from the menu settings dashboard)
// ============================================================

export interface AdminPizzaGroupSize {
  id: PizzaSizeId;
  name: string;
  slices: number;
  maxFlavors: number;
  /** Null for a size not priced flat in this group (e.g. 'slice', priced via portion splitting instead). */
  price: number | null;
}

export interface AdminPizzaGroup {
  id: PizzaGroupId;
  name: string;
  sizes: AdminPizzaGroupSize[];
}

/** A flavor can belong to more than one group (pizza_group_flavors is many-to-many) - groupIds is which category(ies) it's offered under. */
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

// ============================================================
// EMPLOYEES
// Enough to attribute an order to whoever placed it, plus a role that
// gates admin-only actions (managing employees, deleting orders). Removal
// is a soft delete (isActive: false) so past orders keep a valid
// employeeId. 'admin' rows authenticate with a password (see authService,
// utils/password.ts); 'staff' rows log in by picking their name, no
// password - never exposed here (password_hash stays server-side only).
// ============================================================

export type EmployeeRole = 'staff' | 'admin';

export interface Employee {
  id: number;
  name: string;
  pictureUrl: string | null;
  isActive: boolean;
  role: EmployeeRole;
}

// ============================================================
// CUSTOMERS
// A customer is created/looked up via the /api/customers endpoints (open,
// no auth - see routes/customers.ts) before placing an order; the order
// itself only ever carries a customerId reference, same as employeeId.
// Only deleting a customer outright is admin-gated.
// ============================================================

export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  /** Every saved address for this customer, newest first. */
  addresses: CustomerAddress[];
}

export type PropertyType = "HOUSE" | "APARTMENT" | "OFFICE" | "BUILDING" | "OTHER";

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
  /** Integer COP. The neighborhood's delivery_fee, surfaced here so the frontend doesn't need a second lookup to default a delivery order's fee. */
  deliveryFee: number;
  apartmentNumber: string | null;
  tower: string | null;
  buildingName: string | null;
  reference: string | null;
  /** Nullable - no maps/geocoding integration yet, reserved for one later. */
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
  /** Integer COP. Seeds a new delivery order's deliveryFee unless the client explicitly overrides it - see orderService.createOrder. */
  deliveryFee: number;
}

// ============================================================
// ORDER REQUEST (client -> server payload)
// Client sends references and quantities only. Prices are
// always resolved server-side from the menu.
// ============================================================

/** 'duo': 2 products (personal pizza/lasagna/pasta/gratin) for a flat price. 'pizza_xl': XL pizza + free soda + free bread for a flat price. Prices are admin-editable (see PromoSettings) - see resolvePromoItems for the composition rules. */
export type PromoType = "duo" | "pizza_xl";

/** Admin-editable flat pricing for a promo (see routes/promos.ts) - orderService.applyPromoPricing reads these live at order-creation time. */
export interface PromoSettings {
  promoType: PromoType;
  price: number;
  /** COP. 'pizza_xl' only - the extra charge for choosing Coca-Cola/Quatro as the promo's soda. Always 0 for 'duo'. */
  sodaSurcharge: number;
}

export interface OrderRequest {
  orderType: OrderType;
  /** Required - must be an active employee's id. Every order must be attributable to whoever placed it (see validateOrderRequest). */
  employeeId: number;
  /** Required when orderType = 'dine_in'. 1-9. */
  tableNumber?: number;
  /** Required for 'takeaway' and 'delivery'; optional for 'dine_in' - customers can be attached to any order type. */
  customerId?: number;
  /** Required for 'delivery' only; must be one of customerId's own addresses. */
  customerAddressId?: number;
  notes?: string;
  /**
   * Optional, one entry per promo instance on this order (an order can carry
   * several - e.g. a 'duo' and a 'pizza_xl' together). Each items[].promoGroup
   * is an index into this array; the items tagged with a given index must
   * exactly match that entry's promo composition - see validatePromoItems.
   */
  promos?: PromoType[];
  items: OrderItemRequest[];
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
  /** Index into OrderRequest.promos - which promo instance this item is part of, if any (see validatePromoItems/applyPromoPricing). Lets a promo share an order with extra, normally-priced items, and lets several promos share one order. Omitted for a normally-priced item. */
  promoGroup?: number;
}

export interface ProductItemRequest {
  type: "product";
  category: ProductCategoryId;
  /** Product id within that category. */
  product: string;
  /** id of one of the product's drink flavors, e.g. 'coca_cola'. */
  drinkFlavor?: string;
  /** ProductSize id when the product is priced per size (calzone). */
  size?: string;
  /** Pizza flavor id when the product has pizzaFlavor: true. */
  pizzaFlavor?: string;
  quantity: number;
  notes?: string;
  /** Index into OrderRequest.promos - which promo instance this item is part of, if any (see validatePromoItems/applyPromoPricing). Lets a promo share an order with extra, normally-priced items, and lets several promos share one order. Omitted for a normally-priced item. */
  promoGroup?: number;
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
  /** The customer attached to the order, if any. */
  customerId: number | null;
  /** The delivery address used, if any (delivery orders only). */
  customerAddressId: number | null;
  /**
   * Derived via JOIN from customers/customer_addresses (getOrderById) -
   * these used to be plain columns on `orders` itself; kept under the same
   * field names so printerService/billingService (which only ever read the
   * resolved Order object, never the raw row) didn't need to change.
   */
  customerName: string | null;
  phone: string | null;
  /** Formatted delivery address (street + building/tower/apt + neighborhood + city), delivery orders only. */
  address: string | null;
  /**
   * Integer COP. Computed server-side, sum of items only - excludes
   * tip/deliveryFee/discount. Deliberately NOT the "everything included"
   * figure (see grandTotal for that) so it can never be confused with
   * OrderPayment.grossAmount, which IS tip/deliveryFee-inclusive.
   */
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
   * prices are never decreased by it - see OrderPayment.grossAmount for why.
   */
  discount: number;
  /**
   * Integer COP. `total + tip + deliveryFee` - the one canonical name for
   * "everything the customer owes/paid, before discount". Computed, not
   * stored; exists so callers don't each re-derive it under a different ad
   * hoc name (gross/owed/net all showed up for this exact figure before).
   */
  grandTotal: number;
  /**
   * Empty for the vast majority of orders. One entry per promo instance on
   * this order (an order can carry several) - set once at creation, never
   * changed. `basePrice` is that instance's own flat promo price, derived
   * from its items' unit_price snapshot (same reasoning as the old
   * printerService.promoBasePrice) so it stays correct even if the
   * admin-configured price changes later. `group` is the index items[]
   * .promoGroup points at for items belonging to this instance.
   */
  promos: { group: number; type: PromoType; basePrice: number }[];
  notes: string | null;
  createdAt: string; // ISO / SQLite datetime
  completedAt: string | null;
  items: OrderItem[];
  /**
   * How the order was actually settled. Empty until completion; POST
   * /api/orders/:id/complete writes one row per method used (a plain
   * single-method payment is just one entry). grossAmounts always sum to
   * `grandTotal`.
   */
  payments: OrderPayment[];
  /**
   * True once a bill/invoice document has been generated and saved for this
   * order (print_jobs, kind 'bill') - via a dine-in pre-payment preview
   * ("Ver o imprimir factura"), the post-payment "Imprimir factura", or the
   * automatic print at completion for takeaway/delivery. Drives the Order
   * Overview button's preview-vs-checkout state and Order History's
   * reprint-vs-generate branch (see orderService.printInvoice).
   */
  hasBill: boolean;
}

export interface OrderPayment {
  id: number;
  orderId: number;
  method: PaymentMethod;
  /**
   * Integer COP. Total charged via this method, tip and delivery fee
   * included - always the GROSS amount, before this split's `discount`. Named
   * distinctly from Order.total (items only) so the two can never be
   * confused. Never reduced to reflect a discount, so the original
   * pre-discount price stays on record; the actual cash collected is
   * `grossAmount - discount`, derived whenever needed rather than stored.
   */
  grossAmount: number;
  /** Integer COP. The slice of `grossAmount` that's tip rather than sales; 0..grossAmount. */
  tipAmount: number;
  /** Integer COP. The slice of `grossAmount` that's delivery fee rather than sales; 0..grossAmount. */
  deliveryFee: number;
  /**
   * Integer COP. `grossAmount - tipAmount - deliveryFee` - the products-only
   * slice of this split, computed server-side (never client-supplied).
   * SUM(netAmount) across an order's payments always equals order.total
   * exactly. Discount is deliberately NOT subtracted here (see `discount`).
   */
  netAmount: number;
  /**
   * Integer COP. The slice of `netAmount` this split's discount accounts for;
   * 0..netAmount - discounts apply to products, not tip/delivery fee, so
   * it's bounded by netAmount rather than the looser grossAmount.
   */
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
  /**
   * Index into the order's `promos` array - which promo instance this line
   * is part of, or null for a normally-priced item sharing the same order.
   * Can't be inferred from unitPrice (a promo item is priced at the flat
   * promo price, 0, or a soda surcharge - none of which are distinguishable
   * from a regular price), so it's recorded at creation. Always null for
   * items added afterwards.
   */
  promoGroup: number | null;
  /** Null until the queue worker includes this item in a kitchen ticket (original or addendum). */
  printedAt: string | null;
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
  /**
   * COP. Sum of cash payments across this period's COMPLETED orders so far
   * (see endOfDayService.aggregateSales) - add to cashInRegister to get the
   * drawer's expected current cash. Only computed for the *current* period
   * (getCurrentCashFlow/updateCurrentCash/addExpense) - absent on
   * listCashFlowHistory's rows, which would otherwise re-aggregate every past
   * day's orders on every calendar load for no reason.
   */
  cashSalesToday?: number;
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
/** One row of ClosingReport.expensesDetail - a cash_expenses row frozen at closing time. */
export interface ClosingReportExpenseDetail {
  amount: number;
  justification: string;
  createdAt: string;
}

export interface ClosingReport {
  id: number;
  /** YYYY-MM-DD, the business day this report covers. */
  date: string;
  orderCount: number;
  /** COP. Sum of (order.total + order.deliveryFee) for delivery orders, plus card/transfer/rappi tips on those orders (cash tips excluded - see aggregateSales). */
  deliverySales: number;
  /** COP. Sum of (order.total + order.deliveryFee) for dine_in/takeaway orders, plus card/transfer/rappi tips on those orders (cash tips excluded). */
  dineInTakeawaySales: number;
  /** COP. Sum of (order.total + order.deliveryFee), grouped by paymentMethod. Cash excludes tips; card/transfer/rappi include them as income. */
  cashSales: number;
  cardSales: number;
  transferSales: number;
  rappiSales: number;
  /** COP. Grand total sales: deliverySales + dineInTakeawaySales. */
  totalSales: number;
  /** COP. Total tips collected across all payment methods (informational - card/transfer/rappi tips are already folded into totalSales via their method's sales figure; cash tips are not part of totalSales at all). */
  tips: number;
  /** COP. Total discounts given across all payment methods (not subtracted from totalSales - see OrderPayment.grossAmount). */
  discounts: number;
  /** Total quantity of order_items across every COMPLETED order this business day (a pizza with quantity 2 counts as 2). */
  itemsSold: number;
  /** Distinct customers across today's COMPLETED orders - the same customer ordering twice still counts once. */
  customersServed: number;
  deliveryOrderCount: number;
  dineInOrderCount: number;
  takeawayOrderCount: number;
  /** COP. Total cash_expenses recorded against this business day. */
  totalExpenses: number;
  /** Itemized cash_expenses rows for this business day, frozen at closing time. */
  expensesDetail: ClosingReportExpenseDetail[];
  /** COP. Snapshot of cash_flow.cash_in_register for this business day, taken at closing time. Deliberately NOT part of "Efectivo final en caja" (see endOfDayService.renderClosingReceipt) - kept only as a historical record of what the register's base was that day. */
  cashInRegister: number;
  /** The exact plain-text thermal-receipt content generated at closing time - what a reprint re-sends verbatim (see reprintClosingReport). */
  content: string;
  createdAt: string;
}

// ---------- Analytics (analyticsService) ----------
// Every figure below is computed live over a date range, never read from
// closing_reports - see analyticsService.ts. Sales figures use the same
// formula as SalesAggregate (analyticsService.NET_SALES_SQL, mirroring
// endOfDayService.aggregateSales): discounts always subtracted, cash tips
// excluded, card/transfer/Rappi tips included as income.

export type AnalyticsRange = "today" | "week" | "month" | "custom";

export interface SalesSummary {
  /** COP. Discounts subtracted; cash tips excluded, card/transfer/Rappi tips included - the real income for the selected range. */
  totalSales: number;
  /** Percent change vs. the immediately preceding period of equal length. null when the prior period had zero sales (no baseline to compare against). */
  totalSalesGrowthPct: number | null;
  orderCount: number;
  orderCountGrowthPct: number | null;
  /** COP. totalSales / orderCount, 0 when orderCount is 0. */
  avgOrderValue: number;
  avgOrderValueGrowthPct: number | null;
  /** Sum of order_items.quantity / orderCount, 0 when orderCount is 0. */
  itemsPerOrder: number;
  /** Distinct customers across the range's COMPLETED orders - the same customer ordering twice still counts once. */
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
  /** Always all 4 methods, 0 for any unused in the range. */
  paymentMethods: PaymentMethodBreakdown[];
  /** Always all 3 order types, 0 for any unused in the range. */
  orderTypes: OrderTypeBreakdown[];
}

export interface HeatmapCell {
  /** 0 (Sunday) - 6 (Saturday), SQLite strftime('%w') convention. */
  dow: number;
  /** 0-23, Bogota local hour. */
  hour: number;
  orderCount: number;
}

export interface ProductRanking {
  /** "{category} - {product}" (plus " - {size}" when sized), or for pizzas just "Pizza {size}" - flavor is deliberately not part of this name at all (moved to FlavorRanking/getFlavors below), so single-flavor and split/mitad-y-mitad pizzas of the same size share one row. */
  name: string;
  category: string;
  quantity: number;
  /** COP. Sum of order_items.quantity * unit_price for this product/pizza grouping. */
  revenue: number;
}

export interface CategoryRevenue {
  /** A real categories.name, or the synthetic "Pizzas" bucket - pizzas have no categories row of their own (modeled via pizza_groups/pizza_sizes/pizza_flavors instead). */
  category: string;
  quantity: number;
  /** COP. */
  revenue: number;
}

export interface ProductsAnalytics {
  /** Sorted by revenue descending - slice/re-sort client-side for top/bottom-N by either metric, small enough (menu-sized) to not need separate queries. */
  products: ProductRanking[];
  categories: CategoryRevenue[];
}

/** The three categories whose items carry a pizza flavor (order_items.pizza_flavor_id, or order_item_flavors for split pizzas) - the only categories getFlavors can filter to. Pastas/lasagnas/appetizers/drinks/desserts have no flavor concept (the product name itself is the variant), so they're outside this endpoint entirely. */
export type FlavorAnalyticsCategory = 'pizzas' | 'gratinados' | 'calzones';

export interface FlavorRanking {
  flavor: string;
  /** Fractional for pizza flavors (portion-weighted - see getFlavors): a pizza split 50/50 between two flavors contributes 0.5 to each, so the numbers add up to the real slice-equivalent count instead of double-counting a split pizza under every flavor it carries. Always a whole number for gratinados/calzones (one flavor per item, no splitting). */
  quantity: number;
  /** COP. Same portion-weighting as quantity. */
  revenue: number;
}

export interface FlavorAnalytics {
  /** Sorted by revenue descending. Combines every category unless the caller filtered to one - e.g. "Napolitana" sold as both a pizza and a gratinado counts toward one combined total when no category filter is applied. */
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
  /** customers.created_at falls inside the selected range. */
  newCustomers: number;
  /** Distinct customers who ordered inside the range but were created before it started. */
  returningCustomers: number;
}

export interface CustomersAnalytics {
  /** Top spenders in the range, capped server-side (see analyticsService.getCustomers). */
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
  /** COP. Sum of order_payments.discount across the range. */
  totalDiscount: number;
  totalOrders: number;
  ordersWithDiscount: number;
  /** ordersWithDiscount / totalOrders * 100, 0 when totalOrders is 0. */
  discountedOrderPct: number;
}

// ---------- Type guards ----------

export function isPizzaCategory(c: MenuCategory): c is PizzaCategory {
  return c.id === "pizzas";
}

export function isPizzaItem(i: OrderItemRequest): i is PizzaItemRequest {
  return i.type === "pizza";
}
