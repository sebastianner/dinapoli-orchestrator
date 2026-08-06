import db from '../db/index.js';
import { ValidationError } from '../utils/errors.js';
import { currentBusinessDateBogota, BUSINESS_DAY_SQL_OFFSET } from '../utils/date.js';
import type {
  AnalyticsRange,
  SalesSummary,
  SalesTrendPoint,
  SalesBreakdown,
  HeatmapCell,
  ProductsAnalytics,
  ProductRanking,
  CategoryRevenue,
  CustomersAnalytics,
  EmployeePerformance,
  PromoUsageSummary,
} from '../types/dinapoly-types.js';

export interface ResolvedRange {
  /** YYYY-MM-DD, inclusive, Bogota business day. */
  start: string;
  end: string;
  /** The immediately preceding period of equal length - used for growthPct comparisons. */
  prevStart: string;
  prevEnd: string;
}

// today=1 day, week/month=trailing rolling windows (not calendar week/month).
// A rolling window keeps growthPct comparisons apples-to-apples (7 days vs.
// 7 days, 30 vs. 30) regardless of where "today" falls in the calendar week
// or month - a calendar-aligned "this month" would compare a partial current
// month against a full prior one, which skews the growth figure for most of
// the month.
const RANGE_DAYS: Record<'today' | 'week' | 'month', number> = { today: 1, week: 7, month: 30 };

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  const msPerDay = 86400000;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / msPerDay);
}

/**
 * Resolves an AnalyticsRange into concrete Bogota-business-day bounds plus
 * the comparison window used for growthPct figures. See RANGE_DAYS above for
 * why week/month are trailing windows rather than calendar-aligned.
 */
export function resolveRange(range: AnalyticsRange, from?: string, to?: string): ResolvedRange {
  if (range === 'custom') {
    if (!from || !to) throw new ValidationError("range=custom requiere tanto 'from' como 'to' (YYYY-MM-DD)");
    if (from > to) throw new ValidationError("'from' no puede ser posterior a 'to'");
    const spanDays = daysBetween(from, to) + 1;
    return { start: from, end: to, prevStart: addDays(from, -spanDays), prevEnd: addDays(from, -1) };
  }
  const today = currentBusinessDateBogota();
  const spanDays = RANGE_DAYS[range];
  const end = today;
  const start = addDays(today, -(spanDays - 1));
  return { start, end, prevStart: addDays(start, -spanDays), prevEnd: addDays(start, -1) };
}

function growthPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

// ---------- Summary ----------

interface PeriodTotals {
  totalSales: number;
  orderCount: number;
  itemsSold: number;
  customersServed: number;
}

// LEFT JOIN order_payments so an order somehow missing payment rows still
// counts toward orderCount (defensive - shouldn't happen for COMPLETED
// orders, but a missing join shouldn't silently drop the order from the count).
const getOrderPaymentTotals = db.prepare<
  [string, string],
  { order_count: number; total_sales: number | null; customers_served: number | null }
>(`
  SELECT
    COUNT(DISTINCT o.id) AS order_count,
    COALESCE(SUM(op.gross_amount - op.tip_amount - op.discount), 0) AS total_sales,
    COUNT(DISTINCT o.customer_id) AS customers_served
  FROM orders o
  LEFT JOIN order_payments op ON op.order_id = o.id
  WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
`);

const getItemsSoldForRange = db.prepare<[string, string], { total: number | null }>(`
  SELECT COALESCE(SUM(oi.quantity), 0) AS total
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
`);

function periodTotals(start: string, end: string): PeriodTotals {
  const row = getOrderPaymentTotals.get(start, end)!;
  return {
    totalSales: row.total_sales ?? 0,
    orderCount: row.order_count,
    itemsSold: getItemsSoldForRange.get(start, end)?.total ?? 0,
    customersServed: row.customers_served ?? 0,
  };
}

export function getSummary(resolved: ResolvedRange): SalesSummary {
  const current = periodTotals(resolved.start, resolved.end);
  const previous = periodTotals(resolved.prevStart, resolved.prevEnd);
  const avgOrderValue = current.orderCount > 0 ? current.totalSales / current.orderCount : 0;
  const prevAvgOrderValue = previous.orderCount > 0 ? previous.totalSales / previous.orderCount : 0;
  const itemsPerOrder = current.orderCount > 0 ? current.itemsSold / current.orderCount : 0;

  return {
    totalSales: current.totalSales,
    totalSalesGrowthPct: growthPct(current.totalSales, previous.totalSales),
    orderCount: current.orderCount,
    orderCountGrowthPct: growthPct(current.orderCount, previous.orderCount),
    avgOrderValue,
    avgOrderValueGrowthPct: growthPct(avgOrderValue, prevAvgOrderValue),
    itemsPerOrder,
    customersServed: current.customersServed,
    customersServedGrowthPct: growthPct(current.customersServed, previous.customersServed),
  };
}

// ---------- Sales trend ----------

const getHourlyTrend = db.prepare<[string], { bucket: string; order_count: number; total_sales: number | null }>(`
  SELECT
    strftime('%H', o.completed_at, '-5 hours') AS bucket,
    COUNT(DISTINCT o.id) AS order_count,
    COALESCE(SUM(op.gross_amount - op.tip_amount - op.discount), 0) AS total_sales
  FROM orders o
  LEFT JOIN order_payments op ON op.order_id = o.id
  WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') = ?
  GROUP BY bucket
`);

// Both the bucket and the range filter use BUSINESS_DAY_SQL_OFFSET, and they
// have to agree. The bucket used to be the plain Bogota date while the filter
// was the business day, which quietly lost data: an order completed at 00:30 on
// the 24th belongs to the 23rd's service, so the filter included it but the
// bucket put it on the 24th - a bar outside the requested window, dropped
// entirely by getSalesTrend's zero-fill. A range ending on the 23rd showed
// $10.000 on a night that took $30.000, and disagreed with the KPI card
// directly above it.
//
// This is the "how much did we sell on day X" view, so day X is the business
// day - the same day the closing report and the calendar heatmap use. Charts
// that answer "at what time of day" (getHourlyTrend's hour, getHeatmapRows'
// day/hour) deliberately stay on the real clock instead; see those queries.
const getDailyTrend = db.prepare<[string, string], { bucket: string; order_count: number; total_sales: number | null }>(`
  SELECT
    date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') AS bucket,
    COUNT(DISTINCT o.id) AS order_count,
    COALESCE(SUM(op.gross_amount - op.tip_amount - op.discount), 0) AS total_sales
  FROM orders o
  LEFT JOIN order_payments op ON op.order_id = o.id
  WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
  GROUP BY bucket
`);

const DAY_LABELS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function dayLabel(dateStr: string): string {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  const dayOfMonth = Number(dateStr.slice(8, 10));
  return `${DAY_LABELS[dow]} ${dayOfMonth}`;
}

/** Hourly buckets when the range is a single day, daily buckets otherwise - every bucket in the window is present, zero-filled if no orders landed in it. */
export function getSalesTrend(resolved: ResolvedRange): SalesTrendPoint[] {
  if (resolved.start === resolved.end) {
    const rows = new Map(getHourlyTrend.all(resolved.start).map((r) => [r.bucket, r]));
    return Array.from({ length: 24 }, (_, hour) => {
      const key = String(hour).padStart(2, '0');
      const row = rows.get(key);
      return {
        date: key,
        bucketLabel: `${key}:00`,
        totalSales: row?.total_sales ?? 0,
        orderCount: row?.order_count ?? 0,
      };
    });
  }

  const rows = new Map(getDailyTrend.all(resolved.start, resolved.end).map((r) => [r.bucket, r]));
  const points: SalesTrendPoint[] = [];
  const spanDays = daysBetween(resolved.start, resolved.end) + 1;
  for (let i = 0; i < spanDays; i++) {
    const date = addDays(resolved.start, i);
    const row = rows.get(date);
    points.push({
      date,
      bucketLabel: dayLabel(date),
      totalSales: row?.total_sales ?? 0,
      orderCount: row?.order_count ?? 0,
    });
  }
  return points;
}

// ---------- Breakdown (payment methods + order types) ----------

const getPaymentMethodBreakdown = db.prepare<[string, string], { method: string; sales: number | null }>(`
  SELECT op.method AS method, COALESCE(SUM(op.gross_amount - op.tip_amount - op.discount), 0) AS sales
  FROM order_payments op
  JOIN orders o ON o.id = op.order_id
  WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
  GROUP BY op.method
`);

const getOrderTypeBreakdown = db.prepare<
  [string, string],
  { order_type: string; order_count: number; sales: number | null }
>(`
  SELECT o.order_type AS order_type, COUNT(DISTINCT o.id) AS order_count,
         COALESCE(SUM(op.gross_amount - op.tip_amount - op.discount), 0) AS sales
  FROM orders o
  LEFT JOIN order_payments op ON op.order_id = o.id
  WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
  GROUP BY o.order_type
`);

export function getBreakdown(resolved: ResolvedRange): SalesBreakdown {
  const paymentRows = new Map(getPaymentMethodBreakdown.all(resolved.start, resolved.end).map((r) => [r.method, r.sales ?? 0]));
  const orderTypeRows = new Map(
    getOrderTypeBreakdown.all(resolved.start, resolved.end).map((r) => [r.order_type, { sales: r.sales ?? 0, orderCount: r.order_count }])
  );

  return {
    paymentMethods: (['cash', 'card', 'transfer', 'rappi'] as const).map((method) => ({
      method,
      sales: paymentRows.get(method) ?? 0,
    })),
    orderTypes: (['delivery', 'dine_in', 'takeaway'] as const).map((orderType) => ({
      orderType,
      sales: orderTypeRows.get(orderType)?.sales ?? 0,
      orderCount: orderTypeRows.get(orderType)?.orderCount ?? 0,
    })),
  };
}

// ---------- Heatmap ----------

// Bucketed by created_at (when the order came in), not completed_at (when it
// was settled) - "when are we busy" is a kitchen-load/staffing question, so
// it should reflect when orders arrive, not whenever the customer happened
// to pay. Every other analytics query intentionally stays on completed_at
// (it's about settled sales), so this is a deliberate exception.
//
// dow/hour deliberately use the plain Bogota offset, NOT
// BUSINESS_DAY_SQL_OFFSET - unlike every other analytics/report query (which
// buckets by business day, e.g. a 1am order counts toward the previous
// day's closing report), the heatmap is a real time-of-day/day-of-week
// pattern, not a financial rollup: a 1am order should land on the real
// day it happened (Tuesday), not get folded into "Monday" just because
// Monday's business day hadn't closed yet. The range filter (BETWEEN)
// still uses the business day, though, so the heatmap's populated window
// matches whatever range the rest of the page has selected.
// Also deliberately NOT filtered to status = 'COMPLETED', unlike every sales
// query. This is a kitchen-load question, and an order that arrived is load on
// the kitchen whether or not it has been paid for yet - filtering to COMPLETED
// made the current shift's busiest hours read as empty right when someone would
// be looking at them.
const getHeatmapRows = db.prepare<[string, string], { dow: string; hour: string; order_count: number }>(`
  SELECT
    strftime('%w', o.created_at, '-5 hours') AS dow,
    strftime('%H', o.created_at, '-5 hours') AS hour,
    COUNT(*) AS order_count
  FROM orders o
  WHERE date(o.created_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
  GROUP BY dow, hour
`);

/** Full 7x24 grid, zero-filled - the frontend heatmap renders every cell regardless of data. */
export function getHeatmap(resolved: ResolvedRange): HeatmapCell[] {
  const rows = new Map(getHeatmapRows.all(resolved.start, resolved.end).map((r) => [`${r.dow}-${r.hour}`, r.order_count]));
  const cells: HeatmapCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const key = `${dow}-${String(hour).padStart(2, '0')}`;
      cells.push({ dow, hour, orderCount: rows.get(key) ?? 0 });
    }
  }
  return cells;
}

// ---------- Products ----------

// Pizzas aren't in `products` (modeled separately via pizza_groups/sizes/
// flavors, order_items.item_type = 'pizza') so they need their own branches.
// A pizza's order_item_flavors row count tells single-flavor from split
// (mitad y mitad) apart - see ProductRanking's doc comment for why split
// pizzas are bucketed by size only rather than fractionally attributed.
const getProductRankingRows = db.prepare<
  [string, string, string, string, string, string],
  { name: string; category: string; quantity: number; revenue: number }
>(`
  WITH pizza_flavor_counts AS (
    SELECT order_item_id, COUNT(*) AS flavor_count
    FROM order_item_flavors
    GROUP BY order_item_id
  )
  SELECT p.name AS name, cat.name AS category,
         SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  JOIN products p ON p.id = oi.product_id
  JOIN categories cat ON cat.id = p.category_id
  WHERE oi.item_type = 'product' AND o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
  GROUP BY p.id

  UNION ALL

  SELECT (pf.name || ' ' || ps.name) AS name, 'Pizzas' AS category,
         SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  JOIN pizza_flavor_counts pfc ON pfc.order_item_id = oi.id AND pfc.flavor_count = 1
  JOIN order_item_flavors oif ON oif.order_item_id = oi.id
  JOIN pizza_flavors pf ON pf.id = oif.flavor_id
  JOIN pizza_sizes ps ON ps.id = oi.pizza_size_id
  WHERE oi.item_type = 'pizza' AND o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
  GROUP BY pf.id, ps.id

  UNION ALL

  SELECT ('Pizza mitad y mitad ' || ps.name) AS name, 'Pizzas' AS category,
         SUM(oi.quantity) AS quantity, SUM(oi.quantity * oi.unit_price) AS revenue
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  JOIN pizza_flavor_counts pfc ON pfc.order_item_id = oi.id AND pfc.flavor_count > 1
  JOIN pizza_sizes ps ON ps.id = oi.pizza_size_id
  WHERE oi.item_type = 'pizza' AND o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
  GROUP BY ps.id
`);

/** All sold products/pizzas, sorted by revenue descending. Menu-sized (dozens of rows), so top/bottom-N by either quantity or revenue is just a client-side slice/re-sort - no separate queries per metric. */
export function getProducts(resolved: ResolvedRange): ProductsAnalytics {
  const { start, end } = resolved;
  const rows = getProductRankingRows.all(start, end, start, end, start, end);

  const products: ProductRanking[] = rows
    .map((r) => ({ name: r.name, category: r.category, quantity: r.quantity, revenue: r.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const categoryTotals = new Map<string, { quantity: number; revenue: number }>();
  for (const p of products) {
    const existing = categoryTotals.get(p.category) ?? { quantity: 0, revenue: 0 };
    existing.quantity += p.quantity;
    existing.revenue += p.revenue;
    categoryTotals.set(p.category, existing);
  }
  const categories: CategoryRevenue[] = Array.from(categoryTotals.entries())
    .map(([category, totals]) => ({ category, ...totals }))
    .sort((a, b) => b.revenue - a.revenue);

  return { products, categories };
}

// ---------- Customers ----------

const TOP_CUSTOMERS_LIMIT = 15;

const getTopCustomersRows = db.prepare<
  [string, string],
  { id: number; name: string; phone: string | null; order_count: number; spend: number | null }
>(`
  SELECT c.id AS id, c.name AS name, c.phone AS phone,
         COUNT(DISTINCT o.id) AS order_count,
         COALESCE(SUM(op.gross_amount - op.tip_amount - op.discount), 0) AS spend
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  LEFT JOIN order_payments op ON op.order_id = o.id
  WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
  GROUP BY c.id
  ORDER BY spend DESC
  LIMIT ${TOP_CUSTOMERS_LIMIT}
`);

const getNewCustomerCount = db.prepare<[string, string], { count: number }>(`
  SELECT COUNT(*) AS count FROM customers WHERE date(created_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
`);

const getReturningCustomerCount = db.prepare<[string, string, string], { count: number }>(`
  SELECT COUNT(DISTINCT o.customer_id) AS count
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
    AND date(c.created_at, '${BUSINESS_DAY_SQL_OFFSET}') < ?
`);

export function getCustomers(resolved: ResolvedRange): CustomersAnalytics {
  const topCustomers = getTopCustomersRows.all(resolved.start, resolved.end).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    orderCount: r.order_count,
    spend: r.spend ?? 0,
  }));

  return {
    topCustomers,
    growth: {
      newCustomers: getNewCustomerCount.get(resolved.start, resolved.end)?.count ?? 0,
      returningCustomers: getReturningCustomerCount.get(resolved.start, resolved.end, resolved.start)?.count ?? 0,
    },
  };
}

// ---------- Employees ----------

const getEmployeePerformanceRows = db.prepare<
  [string, string],
  { id: number; name: string; is_active: number; order_count: number; sales: number | null }
>(`
  SELECT e.id AS id, e.name AS name, e.is_active AS is_active,
         COUNT(DISTINCT o.id) AS order_count,
         COALESCE(SUM(op.gross_amount - op.tip_amount - op.discount), 0) AS sales
  FROM orders o
  JOIN employees e ON e.id = o.employee_id
  LEFT JOIN order_payments op ON op.order_id = o.id
  WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
  GROUP BY e.id
  ORDER BY sales DESC
`);

/** Includes inactive employees - a departed employee's historical performance shouldn't silently vanish from past ranges. */
export function getEmployees(resolved: ResolvedRange): EmployeePerformance[] {
  return getEmployeePerformanceRows.all(resolved.start, resolved.end).map((r) => ({
    id: r.id,
    name: r.name,
    isActive: r.is_active === 1,
    orderCount: r.order_count,
    sales: r.sales ?? 0,
  }));
}

// ---------- Promotions ----------

// Counts promo INSTANCES, not orders - an order can carry more than one
// promo (see order_promos), so a single order using 'duo' twice counts as 2
// here, same as two separate orders would. Two branches: order_promos for
// every order placed since that table existed, falling back to the legacy
// orders.promo_type column for orders that predate it (excluded from the
// first branch via NOT EXISTS, so a given order is never double-counted).
const getPromoCounts = db.prepare<[string, string, string, string], { promo_type: string; order_count: number }>(`
  SELECT promo_type, SUM(order_count) AS order_count FROM (
    SELECT op.promo_type AS promo_type, COUNT(*) AS order_count
    FROM order_promos op
    JOIN orders o ON o.id = op.order_id
    WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
    GROUP BY op.promo_type
    UNION ALL
    SELECT o.promo_type AS promo_type, COUNT(*) AS order_count
    FROM orders o
    WHERE o.status = 'COMPLETED' AND o.promo_type IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM order_promos op WHERE op.order_id = o.id)
      AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
    GROUP BY o.promo_type
  )
  GROUP BY promo_type
`);

const getDiscountTotals = db.prepare<
  [string, string],
  { total_discount: number | null; total_orders: number; orders_with_discount: number }
>(`
  SELECT
    COALESCE(SUM(op.discount), 0) AS total_discount,
    COUNT(DISTINCT o.id) AS total_orders,
    COUNT(DISTINCT CASE WHEN op.discount > 0 THEN o.id END) AS orders_with_discount
  FROM orders o
  LEFT JOIN order_payments op ON op.order_id = o.id
  WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') BETWEEN ? AND ?
`);

export function getPromotions(resolved: ResolvedRange): PromoUsageSummary {
  const promoCounts = getPromoCounts.all(resolved.start, resolved.end, resolved.start, resolved.end).map((r) => ({
    promoType: r.promo_type as 'duo' | 'pizza_xl',
    orderCount: r.order_count,
  }));
  const totals = getDiscountTotals.get(resolved.start, resolved.end)!;

  return {
    promoCounts,
    totalDiscount: totals.total_discount ?? 0,
    totalOrders: totals.total_orders,
    ordersWithDiscount: totals.orders_with_discount,
    discountedOrderPct: totals.total_orders > 0 ? (totals.orders_with_discount / totals.total_orders) * 100 : 0,
  };
}
