import db from '../db/index.js';
import { NotFoundError, ConflictError } from '../utils/errors.js';
import { currentBusinessDateBogota, BUSINESS_DAY_SQL_OFFSET } from '../utils/date.js';
import { printPlainText, formatMoney, centerText, toAsciiText, RECEIPT_WIDTH, formatTimeCO } from './printerService.js';
import type { ClosingReport, ClosingReportExpenseDetail } from '../types/dinapoly-types.js';
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
    rappiSales: row.rappi_sales,
    totalSales: row.total_sales,
    tips: row.tips,
    discounts: row.discounts,
    totalExpenses: row.total_expenses,
    expensesDetail: JSON.parse(row.expenses_detail) as ClosingReportExpenseDetail[],
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
  rappiSales: number;
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
// via currentBusinessDateBogota(). Tip and delivery fee/discount only ever
// exist as the per-method breakdown in order_payments (see schema comment),
// so an order's sales figure is derived by summing (gross_amount - tip_amount - discount)
// across its payment rows - this excludes tips and discounts from sales
// while keeping delivery fees in, exactly, with no proportional guessing.
const getCompletedOrdersForDate = db.prepare<[string], { id: number; order_type: string; customer_id: number | null }>(
  `SELECT id, order_type, customer_id FROM orders WHERE status = 'COMPLETED' AND date(completed_at, '${BUSINESS_DAY_SQL_OFFSET}') = ?`
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
   WHERE o.status = 'COMPLETED' AND date(o.completed_at, '${BUSINESS_DAY_SQL_OFFSET}') = ?`
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
    rappiSales: 0,
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
    else if (method === 'rappi') agg.rappiSales += amount;
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
      // Cash tips are handed straight to staff and never touch the
      // register, so they stay excluded from income (same as before). Tips
      // paid by card, transfer, or Rappi pass through the register/bank, so
      // they now count as income and stay IN the method's net instead of
      // being subtracted out - only cash's net still strips the tip.
      const net = p.method === 'cash' ? p.gross_amount - p.tip_amount - p.discount : p.gross_amount - p.discount;
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

// Itemized version of expensesForDate above - one row per cash_expenses entry
// recorded against this business day's cash_flow period, for printing/showing
// the breakdown (reason + amount) rather than just the aggregate total.
const getCashExpenseDetailsForDate = db.prepare<[string], { amount: number; justification: string; created_at: string }>(
  `SELECT ce.amount AS amount, ce.justification AS justification, ce.created_at AS created_at
   FROM cash_expenses ce
   JOIN cash_flow cf ON cf.id = ce.cash_flow_id
   WHERE cf.date = ?
   ORDER BY ce.id`
);

function expenseDetailsForDate(date: string): ClosingReportExpenseDetail[] {
  return getCashExpenseDetailsForDate.all(date).map((r) => ({ amount: r.amount, justification: r.justification, createdAt: r.created_at }));
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

function renderClosingReceipt(date: string, sales: SalesAggregate, totalExpenses: number, expensesDetail: ClosingReportExpenseDetail[]): string {
  const width = RECEIPT_WIDTH;
  const lines: string[] = [];

  // `date` is the business day the report covers (e.g. a report closed just
  // after midnight can still cover the day before) - not the same thing as
  // when the report was actually generated, which staff also want on the
  // page (e.g. two closings on the same business day, or closing late).
  // Computed once here and baked into the saved content - a reprint
  // (reprintClosingReport) resends that same content unchanged, so it keeps
  // showing the original generation time, not the moment it was reprinted.
  const generatedAt = formatTimeCO(new Date().toISOString());

  lines.push(centerText('DINAPOLI PIZZA', width));
  lines.push(centerText('CIERRE DEL DIA', width));
  lines.push(`Fecha: ${date}, ${generatedAt}`);
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
  // Discounts always subtracted; tips only for cash (handed straight to
  // staff, never touch the register). Card/transfer/Rappi tips pass through
  // the register/bank, so they stay IN these figures as income - see
  // aggregateSales. Same figures shown as "Ventas en X" in the UI.
  lines.push(moneyRow('Ventas en efectivo', sales.cashSales, width));
  lines.push(moneyRow('Ventas en tarjeta', sales.cardSales, width));
  lines.push(moneyRow('Ventas en transferencia', sales.transferSales, width));
  lines.push(moneyRow('Ventas en Rappi', sales.rappiSales, width));
  lines.push('='.repeat(width));
  lines.push(moneyRow('TOTAL VENTAS', sales.totalSales, width));
  lines.push(moneyRow('Propinas', sales.tips, width));
  lines.push(moneyRow('Descuentos', sales.discounts, width));
  lines.push('-'.repeat(width));
  lines.push(centerText('GASTOS DEL DIA', width));
  if (expensesDetail.length === 0) {
    lines.push('Sin gastos registrados');
  } else {
    for (const expense of expensesDetail) {
      lines.push(moneyRow(expense.justification, expense.amount, width));
    }
  }
  lines.push(moneyRow('Total gastos', totalExpenses, width));
  lines.push('-'.repeat(width));
  // Deliberately excludes the base de caja (cash_flow.cash_in_register) -
  // this is meant to read as "cash income and passives for the day", not
  // "what should be physically in the drawer" (that figure - base + cash
  // sales - is what the live Caja page shows instead). Ventas en efectivo
  // already has cash tips stripped out, so subtracting today's expenses is
  // the only adjustment needed here.
  lines.push(moneyRow('Efectivo final en caja', sales.cashSales - totalExpenses, width));
  lines.push('='.repeat(width));

  return toAsciiText(lines.join('\n'));
}

const insertClosingReport = db.prepare<
  [string, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, string, string]
>(
  `INSERT INTO closing_reports
     (date, order_count, delivery_sales, dine_in_takeaway_sales, cash_sales, card_sales, transfer_sales, rappi_sales, total_sales, tips, discounts,
      items_sold, customers_served, delivery_order_count, dine_in_order_count, takeaway_order_count, total_expenses, cash_in_register, expenses_detail, content)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const getClosingReportRow = db.prepare<[number], ClosingReportRow>('SELECT * FROM closing_reports WHERE id = ?');
const listClosingReportRows = db.prepare<[], ClosingReportRow>('SELECT * FROM closing_reports ORDER BY id DESC');

// Closing the day while orders are still open would silently under-report
// sales (an order that completes later would never make it into this
// snapshot) - block it instead.
//
// Deliberately NOT scoped to today's business day. Sales are aggregated by
// completed_at, so an order left open from an earlier day still lands in
// whichever day it is eventually settled on, and scoping the guard to
// created_at let exactly that order slip past unnoticed. Any open order is a
// reason to stop and deal with it, however old.
const getOpenOrders = db.prepare<[], { id: number; business_day: string }>(
  `SELECT id, date(created_at, '${BUSINESS_DAY_SQL_OFFSET}') AS business_day
   FROM orders WHERE status != 'COMPLETED' ORDER BY id`
);

/**
 * Generates today's (Bogota business day) End-of-Day closing report: gathers
 * every COMPLETED order for the day, categorizes sales by order type and
 * payment method (cash tips excluded, card/transfer/Rappi tips included as
 * income, delivery fees included), pulls the day's itemized expenses from
 * cash_expenses, persists the snapshot, and prints it. Always
 * an explicit staff action - see cash_flow's schema comment for why the daily
 * register rotation itself is automatic while this is not. Any employee can
 * call this (see routes/endOfDay.ts) as long as every one of today's orders
 * is already COMPLETED.
 */
export async function closeDay(): Promise<ClosingReport> {
  const date = currentBusinessDateBogota();

  const openOrders = getOpenOrders.all();
  if (openOrders.length > 0) {
    const one = openOrders.length === 1;
    // Naming the orders matters when one of them is from an earlier day - staff
    // would otherwise look through today's floor for something that isn't there.
    const listed = openOrders
      .slice(0, 10)
      .map((o) => (o.business_day === date ? `#${o.id}` : `#${o.id} (${o.business_day})`))
      .join(', ');
    const andMore = openOrders.length > 10 ? ` y ${openOrders.length - 10} más` : '';
    throw new ConflictError(
      `${openOrders.length} orden${one ? '' : 'es'} ${one ? 'sigue abierta' : 'siguen abiertas'}: ${listed}${andMore} - ` +
        `complétala${one ? '' : 's'} o elimínala${one ? '' : 's'} antes de cerrar el día`
    );
  }

  const sales = aggregateSales(date);
  const totalExpenses = expensesForDate(date);
  const expensesDetail = expenseDetailsForDate(date);
  const cashInRegister = cashInRegisterForDate(date);
  const content = renderClosingReceipt(date, sales, totalExpenses, expensesDetail);

  const { lastInsertRowid } = insertClosingReport.run(
    date,
    sales.orderCount,
    sales.deliverySales,
    sales.dineInTakeawaySales,
    sales.cashSales,
    sales.cardSales,
    sales.transferSales,
    sales.rappiSales,
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
    JSON.stringify(expensesDetail),
    content
  );

  try {
    await printPlainText(content);
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
export async function reprintClosingReport(id: number): Promise<void> {
  const row = getClosingReportRow.get(id);
  if (!row) throw new NotFoundError(`informe de cierre ${id} no encontrado`);
  await printPlainText(row.content);
}
