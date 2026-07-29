import db from '../db/index.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import { todayDateStrBogota } from '../utils/date.js';
import { printPlainText, formatMoney, centerText, toAsciiText, RECEIPT_WIDTH } from './printerService.js';
import type { ClosingReport } from '../types/dinapoly-types.js';
import type { ClosingReportRow } from '../types/db.js';

function rowToClosingReport(row: ClosingReportRow): ClosingReport {
  return {
    id: row.id,
    date: row.date,
    orderCount: row.order_count,
    deliverySales: row.delivery_sales,
    dineInTakeawaySales: row.dine_in_takeaway_sales,
    cashSales: row.cash_sales,
    cardSales: row.card_sales,
    transferSales: row.transfer_sales,
    totalSales: row.total_sales,
    tips: row.tips,
    discounts: row.discounts,
    totalExpenses: row.total_expenses,
    itemsSold: row.items_sold,
    customersServed: row.customers_served,
    deliveryOrderCount: row.delivery_order_count,
    dineInOrderCount: row.dine_in_order_count,
    takeawayOrderCount: row.takeaway_order_count,
    cashInRegister: row.cash_in_register,
    content: row.content,
    createdAt: row.created_at,
  };
}

export interface SalesAggregate {
  orderCount: number;
  deliverySales: number;
  dineInTakeawaySales: number;
  cashSales: number;
  cardSales: number;
  transferSales: number;
  totalSales: number;
  tips: number;
  discounts: number;
  itemsSold: number;
  customersServed: number;
  deliveryOrderCount: number;
  dineInOrderCount: number;
  takeawayOrderCount: number;
}

// completed_at is stored in UTC; Bogota has no DST (fixed UTC-5 year round),
// so a static offset reliably matches the same business day computed in JS
// via todayDateStrBogota(). Tip and delivery fee/discount only ever exist as
// the per-method breakdown in order_payments (see schema comment), so an
// order's sales figure is derived by summing (gross_amount - tip_amount - discount)
// across its payment rows - this excludes tips and discounts from sales
// while keeping delivery fees in, exactly, with no proportional guessing.
const getCompletedOrdersForDate = db.prepare<[string], { id: number; order_type: string; customer_id: number | null }>(
  `SELECT id, order_type, customer_id FROM orders WHERE status = 'COMPLETED' AND date(completed_at, '-5 hours') = ?`
);

const getPaymentsForOrder = db.prepare<[number], { method: string; gross_amount: number; tip_amount: number; discount: number }>(
  'SELECT method, gross_amount, tip_amount, discount FROM order_payments WHERE order_id = ? ORDER BY id'
);

// Summed separately from the per-order loop below (one query instead of one
// per order) since it doesn't need to be split by order.
const getItemsSoldForDate = db.prepare<[string], { total: number | null }>(
  `SELECT COALESCE(SUM(oi.quantity), 0) AS total
   FROM order_items oi
   JOIN orders o ON o.id = oi.order_id
   WHERE o.status = 'COMPLETED' AND date(o.completed_at, '-5 hours') = ?`
);

export function aggregateSales(date: string): SalesAggregate {
  const rows = getCompletedOrdersForDate.all(date);
  const agg: SalesAggregate = {
    orderCount: rows.length,
    deliverySales: 0,
    dineInTakeawaySales: 0,
    cashSales: 0,
    cardSales: 0,
    transferSales: 0,
    totalSales: 0,
    tips: 0,
    discounts: 0,
    itemsSold: getItemsSoldForDate.get(date)?.total ?? 0,
    customersServed: 0,
    deliveryOrderCount: 0,
    dineInOrderCount: 0,
    takeawayOrderCount: 0,
  };

  function addMethodSales(method: string, amount: number): void {
    if (method === 'cash') agg.cashSales += amount;
    else if (method === 'card') agg.cardSales += amount;
    else if (method === 'transfer') agg.transferSales += amount;
  }

  // "Customers served" = distinct customers, not distinct orders - the same
  // customer placing two orders in one day still only counts once.
  const customerIds = new Set<number>();

  for (const row of rows) {
    if (row.customer_id != null) customerIds.add(row.customer_id);
    if (row.order_type === 'delivery') agg.deliveryOrderCount++;
    else if (row.order_type === 'dine_in') agg.dineInOrderCount++;
    else if (row.order_type === 'takeaway') agg.takeawayOrderCount++;

    let salesAmount = 0;
    for (const p of getPaymentsForOrder.all(row.id)) {
      const net = p.gross_amount - p.tip_amount - p.discount;
      addMethodSales(p.method, net);
      salesAmount += net;
      agg.tips += p.tip_amount;
      agg.discounts += p.discount;
    }
    agg.totalSales += salesAmount;
    if (row.order_type === 'delivery') agg.deliverySales += salesAmount;
    else agg.dineInTakeawaySales += salesAmount;
  }
  agg.customersServed = customerIds.size;
  return agg;
}

// cash_flow rows are seeded before any expense is recorded, so a day with
// zero expenses simply has no matching row - hence COALESCE rather than
// relying on a guaranteed row.
const getExpensesForDate = db.prepare<[string], { total: number | null }>(
  'SELECT COALESCE(SUM(expenses), 0) AS total FROM cash_flow WHERE date = ?'
);

function expensesForDate(date: string): number {
  return getExpensesForDate.get(date)?.total ?? 0;
}

const getCashInRegisterForDate = db.prepare<[string], { cash_in_register: number }>(
  'SELECT cash_in_register FROM cash_flow WHERE date = ?'
);

/** The register's base cash for `date` (see cashFlowService.getCurrentCashFlow) - 0 if no cash_flow row exists yet for that day. */
function cashInRegisterForDate(date: string): number {
  return getCashInRegisterForDate.get(date)?.cash_in_register ?? 0;
}

function moneyRow(label: string, amount: number, width: number): string {
  const value = formatMoney(amount);
  const padding = Math.max(1, width - label.length - value.length);
  return `${label}${' '.repeat(padding)}${value}`;
}

function renderClosingReceipt(date: string, sales: SalesAggregate, totalExpenses: number, cashInRegister: number): string {
  const width = RECEIPT_WIDTH;
  const lines: string[] = [];

  lines.push(centerText('DINAPOLI PIZZA', width));
  lines.push(centerText('CIERRE DEL DIA', width));
  lines.push(`Fecha: ${date}`);
  lines.push(`Ordenes completadas: ${sales.orderCount}`);
  lines.push(`Articulos vendidos: ${sales.itemsSold}`);
  lines.push(`Clientes atendidos: ${sales.customersServed}`);
  lines.push('-'.repeat(width));
  lines.push(centerText('ORDENES POR TIPO', width));
  lines.push(`Domicilio: ${sales.deliveryOrderCount}`);
  lines.push(`Mesa: ${sales.dineInOrderCount}`);
  lines.push(`Para llevar: ${sales.takeawayOrderCount}`);
  lines.push('-'.repeat(width));
  lines.push(centerText('VENTAS POR TIPO', width));
  lines.push(moneyRow('Domicilio', sales.deliverySales, width));
  lines.push(moneyRow('Mesa / Para llevar', sales.dineInTakeawaySales, width));
  lines.push('-'.repeat(width));
  lines.push(centerText('VENTAS POR METODO DE PAGO', width));
  // Net of tips and discounts already (see aggregateSales) - the real money
  // collected via each method, same figures shown as "Ventas en X" in the UI.
  lines.push(moneyRow('Ventas en efectivo', sales.cashSales, width));
  lines.push(moneyRow('Ventas en tarjeta', sales.cardSales, width));
  lines.push(moneyRow('Ventas en transferencia', sales.transferSales, width));
  lines.push('='.repeat(width));
  lines.push(moneyRow('TOTAL VENTAS', sales.totalSales, width));
  lines.push(moneyRow('Propinas', sales.tips, width));
  lines.push(moneyRow('Descuentos', sales.discounts, width));
  lines.push(moneyRow('Gastos del dia', totalExpenses, width));
  lines.push('-'.repeat(width));
  // Base de caja del dia + ventas en efectivo - lo que deberia haber en la
  // caja al cierre (ver cashFlowService.getCurrentCashFlow).
  lines.push(moneyRow('Efectivo final en caja', cashInRegister + sales.cashSales, width));
  lines.push('='.repeat(width));

  return toAsciiText(lines.join('\n'));
}

const insertClosingReport = db.prepare<
  [string, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, string]
>(
  `INSERT INTO closing_reports
     (date, order_count, delivery_sales, dine_in_takeaway_sales, cash_sales, card_sales, transfer_sales, total_sales, tips, discounts,
      items_sold, customers_served, delivery_order_count, dine_in_order_count, takeaway_order_count, total_expenses, cash_in_register, content)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const getClosingReportRow = db.prepare<[number], ClosingReportRow>('SELECT * FROM closing_reports WHERE id = ?');
const listClosingReportRows = db.prepare<[], ClosingReportRow>('SELECT * FROM closing_reports ORDER BY id DESC');

// Closing the day while orders are still open would silently under-report
// sales (an order that completes later would never make it into this
// snapshot) - block it instead, same "today" business-day window as
// aggregateSales/order-history's date filter.
const getOpenOrderCountForDate = db.prepare<[string], { count: number }>(
  `SELECT COUNT(*) AS count FROM orders WHERE status != 'COMPLETED' AND date(created_at, '-5 hours') = ?`
);

/**
 * Generates today's (Bogota business day) End-of-Day closing report: gathers
 * every COMPLETED order for the day, categorizes sales by order type and
 * payment method (tips excluded, delivery fees included), pulls the day's
 * total expenses from cash_flow, persists the snapshot, and prints it. Always
 * an explicit staff action - see cash_flow's schema comment for why the daily
 * register rotation itself is automatic while this is not. Any employee can
 * call this (see routes/endOfDay.ts) as long as every one of today's orders
 * is already COMPLETED.
 */
export function closeDay(): ClosingReport {
  const date = todayDateStrBogota();

  const openOrders = getOpenOrderCountForDate.get(date)!.count;
  if (openOrders > 0) {
    throw new ConflictError(
      `${openOrders} orden${openOrders === 1 ? '' : 'es'} de hoy ${openOrders === 1 ? 'no está completada' : 'no están completadas'} - complétala${openOrders === 1 ? '' : 's'} o cancélala${openOrders === 1 ? '' : 's'} antes de cerrar el día`
    );
  }

  const sales = aggregateSales(date);
  const totalExpenses = expensesForDate(date);
  const cashInRegister = cashInRegisterForDate(date);
  const content = renderClosingReceipt(date, sales, totalExpenses, cashInRegister);

  const { lastInsertRowid } = insertClosingReport.run(
    date,
    sales.orderCount,
    sales.deliverySales,
    sales.dineInTakeawaySales,
    sales.cashSales,
    sales.cardSales,
    sales.transferSales,
    sales.totalSales,
    sales.tips,
    sales.discounts,
    sales.itemsSold,
    sales.customersServed,
    sales.deliveryOrderCount,
    sales.dineInOrderCount,
    sales.takeawayOrderCount,
    totalExpenses,
    cashInRegister,
    content
  );

  try {
    printPlainText(content);
  } catch (err) {
    // The report is already durably saved above (content included) - a failure
    // to print (no printer/CUPS on this machine, say) shouldn't undo it or stop
    // the caller from getting the report back; reprint once a printer's available.
    console.error(`[end-of-day] failed to print closing report for ${date} (report saved regardless):`, (err as Error).message);
  }

  return rowToClosingReport(getClosingReportRow.get(Number(lastInsertRowid))!);
}

export function listClosingReports(): ClosingReport[] {
  return listClosingReportRows.all().map(rowToClosingReport);
}

export function getClosingReport(id: number): ClosingReport {
  const row = getClosingReportRow.get(id);
  if (!row) throw new NotFoundError(`informe de cierre ${id} no encontrado`);
  return rowToClosingReport(row);
}

/** Re-sends a previously generated closing report to the printer without recomputing it. */
export function reprintClosingReport(id: number): void {
  const row = getClosingReportRow.get(id);
  if (!row) throw new NotFoundError(`informe de cierre ${id} no encontrado`);
  printPlainText(row.content);
}
