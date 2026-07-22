import db from '../db/index.js';
import { NotFoundError } from '../utils/errors.js';
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
    totalExpenses: row.total_expenses,
    createdAt: row.created_at,
  };
}

interface SalesAggregate {
  orderCount: number;
  deliverySales: number;
  dineInTakeawaySales: number;
  cashSales: number;
  cardSales: number;
  transferSales: number;
  totalSales: number;
}

// completed_at is stored in UTC; Bogota has no DST (fixed UTC-5 year round),
// so a static offset reliably matches the same business day computed in JS
// via todayDateStrBogota(). Tips are excluded (per spec) simply by never
// including order.tip in `sales_amount`; delivery fees are included via
// total + delivery_fee.
const getCompletedOrdersForDate = db.prepare<[string], { id: number; order_type: string; sales_amount: number }>(
  `SELECT id, order_type, (total + delivery_fee) AS sales_amount
   FROM orders
   WHERE status = 'COMPLETED' AND date(completed_at, '-5 hours') = ?`
);

const getPaymentsForOrder = db.prepare<[number], { method: string; amount: number; tip_amount: number }>(
  'SELECT method, amount, tip_amount FROM order_payments WHERE order_id = ? ORDER BY id'
);

function aggregateSales(date: string): SalesAggregate {
  const rows = getCompletedOrdersForDate.all(date);
  const agg: SalesAggregate = {
    orderCount: rows.length,
    deliverySales: 0,
    dineInTakeawaySales: 0,
    cashSales: 0,
    cardSales: 0,
    transferSales: 0,
    totalSales: 0,
  };

  function addMethodSales(method: string, amount: number): void {
    if (method === 'cash') agg.cashSales += amount;
    else if (method === 'card') agg.cardSales += amount;
    else if (method === 'transfer') agg.transferSales += amount;
  }

  for (const row of rows) {
    agg.totalSales += row.sales_amount;
    if (row.order_type === 'delivery') agg.deliverySales += row.sales_amount;
    else agg.dineInTakeawaySales += row.sales_amount;

    // Each payment row already knows exactly how much of its own amount is
    // tip (order_payments.tip_amount, see schema comment), so the sales
    // share per method is exact - no proportional guessing, no rounding.
    // Summed across an order's rows this always equals sales_amount, since
    // amount sums to (total + tip + delivery_fee) and tip_amount sums to tip.
    for (const p of getPaymentsForOrder.all(row.id)) {
      addMethodSales(p.method, p.amount - p.tip_amount);
    }
  }
  return agg;
}

// A COMPLETED order always has a resolved paymentMethod (completeOrder
// requires it), but cash_flow.date rows are seeded before any expense is
// recorded, so a day with zero expenses simply has no matching row - hence
// COALESCE rather than relying on a guaranteed row.
const getExpensesForDate = db.prepare<[string], { total: number | null }>(
  'SELECT COALESCE(SUM(expenses), 0) AS total FROM cash_flow WHERE date = ?'
);

function expensesForDate(date: string): number {
  return getExpensesForDate.get(date)?.total ?? 0;
}

function moneyRow(label: string, amount: number, width: number): string {
  const value = formatMoney(amount);
  const padding = Math.max(1, width - label.length - value.length);
  return `${label}${' '.repeat(padding)}${value}`;
}

function renderClosingReceipt(date: string, sales: SalesAggregate, totalExpenses: number): string {
  const width = RECEIPT_WIDTH;
  const lines: string[] = [];

  lines.push(centerText('DINAPOLI PIZZA', width));
  lines.push(centerText('CIERRE DEL DIA', width));
  lines.push(`Fecha: ${date}`);
  lines.push(`Ordenes completadas: ${sales.orderCount}`);
  lines.push('-'.repeat(width));
  lines.push(centerText('VENTAS POR TIPO', width));
  lines.push(moneyRow('Domicilio', sales.deliverySales, width));
  lines.push(moneyRow('Mesa / Para llevar', sales.dineInTakeawaySales, width));
  lines.push('-'.repeat(width));
  lines.push(centerText('VENTAS POR METODO DE PAGO', width));
  lines.push(moneyRow('Efectivo', sales.cashSales, width));
  lines.push(moneyRow('Tarjeta', sales.cardSales, width));
  lines.push(moneyRow('Transferencia', sales.transferSales, width));
  lines.push('='.repeat(width));
  lines.push(moneyRow('TOTAL VENTAS', sales.totalSales, width));
  lines.push(moneyRow('Gastos del dia', totalExpenses, width));
  lines.push('='.repeat(width));

  return toAsciiText(lines.join('\n'));
}

const insertClosingReport = db.prepare<
  [string, number, number, number, number, number, number, number, number, string]
>(
  `INSERT INTO closing_reports
     (date, order_count, delivery_sales, dine_in_takeaway_sales, cash_sales, card_sales, transfer_sales, total_sales, total_expenses, content)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);
const getClosingReportRow = db.prepare<[number], ClosingReportRow>('SELECT * FROM closing_reports WHERE id = ?');
const listClosingReportRows = db.prepare<[], ClosingReportRow>('SELECT * FROM closing_reports ORDER BY id DESC');

/**
 * Generates today's (Bogota business day) End-of-Day closing report: gathers
 * every COMPLETED order for the day, categorizes sales by order type and
 * payment method (tips excluded, delivery fees included), pulls the day's
 * total expenses from cash_flow, persists the snapshot, and prints it. Always
 * an explicit staff action - see cash_flow's schema comment for why the daily
 * register rotation itself is automatic while this is not.
 */
export function closeDay(): ClosingReport {
  const date = todayDateStrBogota();
  const sales = aggregateSales(date);
  const totalExpenses = expensesForDate(date);
  const content = renderClosingReceipt(date, sales, totalExpenses);

  const { lastInsertRowid } = insertClosingReport.run(
    date,
    sales.orderCount,
    sales.deliverySales,
    sales.dineInTakeawaySales,
    sales.cashSales,
    sales.cardSales,
    sales.transferSales,
    sales.totalSales,
    totalExpenses,
    content
  );

  printPlainText(content);

  return rowToClosingReport(getClosingReportRow.get(Number(lastInsertRowid))!);
}

export function listClosingReports(): ClosingReport[] {
  return listClosingReportRows.all().map(rowToClosingReport);
}

export function getClosingReport(id: number): ClosingReport {
  const row = getClosingReportRow.get(id);
  if (!row) throw new NotFoundError(`closing report ${id} not found`);
  return rowToClosingReport(row);
}

/** Re-sends a previously generated closing report to the printer without recomputing it. */
export function reprintClosingReport(id: number): void {
  const row = getClosingReportRow.get(id);
  if (!row) throw new NotFoundError(`closing report ${id} not found`);
  printPlainText(row.content);
}
