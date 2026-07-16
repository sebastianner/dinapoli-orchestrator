import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '../../print-output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * Printer interface: any implementation must expose print({ orderId, kind, format, content }) -> void.
 * `kind` is a free-form label ('kitchen_ticket' | 'bill'), `format` is 'text' | 'html'.
 * Swap MockPrinter for a real ESC/POS driver (e.g. node-thermal-printer) once printer
 * connection details (network IP / USB path) are known; call sites do not change.
 */
class MockPrinter {
  constructor(name) {
    this.name = name;
  }

  print({ orderId, kind, format, content }) {
    const ext = format === 'html' ? 'html' : 'txt';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${kind}-order${orderId}-${timestamp}.${ext}`;
    const filePath = path.join(OUTPUT_DIR, filename);

    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[printer:${this.name}] printed '${kind}' for order ${orderId} -> ${filename}`);

    return { printer: this.name, filePath, printedAt: new Date().toISOString() };
  }
}

export const kitchenPrinter = new MockPrinter('kitchen');
export const billPrinter = new MockPrinter('billing');

function formatMoney(cop) {
  return `$${cop.toLocaleString('es-CO')}`;
}

export function renderKitchenTicket(order) {
  const lines = [];
  lines.push('== DINAPOLI PIZZA - COMANDA ==');
  lines.push(`Orden #${order.id}  (${order.orderType})`);
  if (order.tableNumber) lines.push(`Mesa: ${order.tableNumber}`);
  if (order.customerName) lines.push(`Cliente: ${order.customerName}`);
  lines.push(`Fecha: ${order.createdAt}`);
  lines.push('-------------------------------');
  for (const item of order.items) {
    if (item.pizzaRef) {
      lines.push(`${item.quantity}x Pizza ${item.pizzaRef.group}/${item.pizzaRef.size}: ${item.pizzaRef.flavors.join(', ')}`);
    } else {
      const ref = item.menuItemRef;
      const bits = [ref.product];
      if (ref.size) bits.push(`(${ref.size})`);
      if (ref.option) bits.push(`- ${ref.option}`);
      if (ref.pizzaFlavor) bits.push(`- sabor: ${ref.pizzaFlavor}`);
      lines.push(`${item.quantity}x [${ref.category}] ${bits.join(' ')}`);
    }
    if (item.notes) lines.push(`   nota: ${item.notes}`);
  }
  if (order.notes) {
    lines.push('-------------------------------');
    lines.push(`Notas: ${order.notes}`);
  }
  lines.push('===============================');
  return lines.join('\n');
}

export function printKitchenTicket(order) {
  return kitchenPrinter.print({
    orderId: order.id,
    kind: 'kitchen_ticket',
    format: 'text',
    content: renderKitchenTicket(order),
  });
}

export { formatMoney };
