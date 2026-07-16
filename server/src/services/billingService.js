import { billPrinter, formatMoney } from './printerService.js';

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function describeItem(item) {
  if (item.pizzaRef) {
    return `Pizza ${item.pizzaRef.group}/${item.pizzaRef.size} (${item.pizzaRef.flavors.join(', ')})`;
  }
  const ref = item.menuItemRef;
  const bits = [ref.product];
  if (ref.size) bits.push(`(${ref.size})`);
  if (ref.option) bits.push(`- ${ref.option}`);
  if (ref.pizzaFlavor) bits.push(`- sabor: ${ref.pizzaFlavor}`);
  return `[${ref.category}] ${bits.join(' ')}`;
}

export function renderBillHtml(order, payment) {
  const rows = order.items
    .map(
      (item) => `
    <tr>
      <td>${escapeHtml(describeItem(item))}${item.notes ? `<br><small>${escapeHtml(item.notes)}</small>` : ''}</td>
      <td>${item.quantity}</td>
      <td>${formatMoney(item.unitPrice)}</td>
      <td>${formatMoney(item.unitPrice * item.quantity)}</td>
    </tr>`
    )
    .join('');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Dinapoli Pizza - Cuenta #${order.id}</title>
<style>
  body { font-family: monospace; font-size: 12px; width: 280px; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 2px 0; }
  .right { text-align: right; }
  hr { border: none; border-top: 1px dashed #000; }
</style>
</head>
<body>
  <h1>DINAPOLI PIZZA</h1>
  <div>Cuenta #${order.id}</div>
  <div>Tipo: ${escapeHtml(order.orderType)}</div>
  ${order.tableNumber ? `<div>Mesa: ${order.tableNumber}</div>` : ''}
  ${order.customerName ? `<div>Cliente: ${escapeHtml(order.customerName)}</div>` : ''}
  <div>Fecha: ${escapeHtml(order.createdAt)}</div>
  <hr>
  <table>
    <thead>
      <tr><th>Item</th><th>Cant</th><th>Vlr Unit</th><th>Total</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <hr>
  <table>
    <tr><td>Total</td><td class="right">${formatMoney(order.total)}</td></tr>
    <tr><td>Pago (${escapeHtml(payment.method)})</td><td class="right">${formatMoney(payment.amountCOP)}</td></tr>
  </table>
  <hr>
  <div style="text-align:center">Gracias por su compra!</div>
</body>
</html>`;
}

export function printBill(order, payment) {
  return billPrinter.print({
    orderId: order.id,
    kind: 'bill',
    format: 'html',
    content: renderBillHtml(order, payment),
  });
}
