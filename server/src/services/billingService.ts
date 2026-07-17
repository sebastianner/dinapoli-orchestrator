import {
  formatMoney,
  formatDateTimeCO,
  describeItem,
  describeOrderType,
  describePaymentMethod,
  toAsciiText,
  printBillHtml,
  LOGO_PLACEHOLDER,
  RECEIPT_WIDTH_PX,
} from './printerService.js';
import type { Order, OrderItem } from '../types/dinapoly-types.js';
import type { Payment } from './paymentService.js';

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function itemRow(item: OrderItem): string {
  const notesHtml = item.notes ? `<div class="item-notes">nota: ${escapeHtml(toAsciiText(item.notes))}</div>` : '';
  return `
    <tr>
      <td>${escapeHtml(toAsciiText(describeItem(item)))}${notesHtml}</td>
      <td class="qty">${item.quantity}</td>
      <td class="num">${formatMoney(item.unitPrice)}</td>
      <td class="num">${formatMoney(item.unitPrice * item.quantity)}</td>
    </tr>`;
}

export function renderBillHtml(order: Order, payment: Payment): string {
  const rows = order.items.map(itemRow).join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  body {
    width: ${RECEIPT_WIDTH_PX}px;
    font-family: 'DejaVu Sans', Arial, sans-serif;
    color: #000;
    padding: 16px 20px 28px;
  }
  .logo { display: block; width: 260px; margin: 0 auto 16px; }
  h1 { text-align: center; font-size: 41px; letter-spacing: 2px; }
  .tagline { text-align: center; font-size: 23px; margin-bottom: 20px; }
  .meta { font-size: 24px; line-height: 1.9; margin-bottom: 10px; }
  .meta-row { display: flex; justify-content: space-between; }
  hr { border: none; border-top: 2px dashed #000; margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 23px; }
  th { text-align: left; font-size: 19px; text-transform: uppercase; border-bottom: 1px solid #000; padding-bottom: 10px; }
  td { padding: 14px 0; vertical-align: top; }
  th.qty, td.qty { text-align: center; width: 62px; }
  th.num, td.num { text-align: right; width: 155px; }
  .item-notes { font-size: 19px; font-style: italic; margin-top: 4px; }
  .totals-row { display: flex; justify-content: space-between; font-size: 25px; padding: 8px 0; }
  .grand { font-size: 33px; font-weight: bold; border-top: 2px solid #000; margin-top: 12px; padding-top: 14px; }
  .thanks { text-align: center; margin-top: 30px; font-size: 27px; font-weight: bold; }
</style>
</head>
<body>
  <img class="logo" src="${LOGO_PLACEHOLDER}" alt="Dinapoli Pizza">
  <h1>DINAPOLI PIZZA</h1>
  <div class="tagline">Cuenta #${order.id}</div>
  <div class="meta">
    <div class="meta-row"><span>Tipo</span><span>${escapeHtml(describeOrderType(order.orderType))}</span></div>
    ${order.tableNumber ? `<div class="meta-row"><span>Mesa</span><span>${order.tableNumber}</span></div>` : ''}
    ${order.customerName ? `<div class="meta-row"><span>Cliente</span><span>${escapeHtml(toAsciiText(order.customerName))}</span></div>` : ''}
    <div class="meta-row"><span>Fecha</span><span>${formatDateTimeCO(order.createdAt)}</span></div>
  </div>
  <hr>
  <table>
    <thead><tr><th>Item</th><th class="qty">Cant</th><th class="num">Vlr Unit</th><th class="num">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <hr>
  <div class="totals-row"><span>Subtotal</span><span>${formatMoney(order.total)}</span></div>
  ${order.deliveryFee > 0 ? `<div class="totals-row"><span>Domicilio</span><span>${formatMoney(order.deliveryFee)}</span></div>` : ''}
  ${order.tip > 0 ? `<div class="totals-row"><span>Propina</span><span>${formatMoney(order.tip)}</span></div>` : ''}
  <div class="totals-row grand"><span>TOTAL</span><span>${formatMoney(order.total + order.deliveryFee + order.tip)}</span></div>
  <div class="totals-row"><span>Pago (${escapeHtml(describePaymentMethod(payment.method))})</span><span>${formatMoney(payment.amountCOP)}</span></div>
  <div class="thanks">Gracias por su compra!</div>
</body>
</html>`;
}

export async function printBill(order: Order, payment: Payment): Promise<void> {
  await printBillHtml(order.id, renderBillHtml(order, payment));
}
