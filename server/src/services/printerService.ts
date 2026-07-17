import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import puppeteer, { type Browser } from 'puppeteer';
import { PNG } from 'pngjs';
import db from '../db/index.js';
import { NotFoundError } from '../utils/errors.js';
import type { Order, OrderItem } from '../types/dinapoly-types.js';
import type { PrintJobKind, PrintJobRow } from '../types/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 80mm paper, Font A (12 dots/char on a 576-dot head) -> 48 columns/line at
// normal size (used for the bill's pixel width). The kitchen ticket prints at
// double size (see CMD_TEXT_DOUBLE below) so each character is twice as wide,
// halving the usable columns per line to 24.
export const RECEIPT_WIDTH = 48;
export const RECEIPT_WIDTH_PX = RECEIPT_WIDTH * 12;
const TICKET_TEXT_WIDTH = RECEIPT_WIDTH / 2;

// Single physical printer for now, reached through its CUPS queue rather than
// a raw /dev/usb/lp* device: CUPS's own USB backend claims the device via
// libusb (detaching the kernel's usblp driver) as soon as it probes it, which
// makes the /dev/usb/lp0 device node come and go unpredictably. `-o raw`
// tells CUPS to skip its filter chain (irrelevant here since the queue's PPD
// doesn't match this printer anyway) and hand our ESC/POS bytes straight to
// the backend.
const CUPS_PRINTER_QUEUE = process.env.PRINTER_QUEUE ?? 'POS-80';

const LOGO_PATH = path.resolve(__dirname, '../assets/dinapoli_pizza_logo.png');
/** Placeholder swapped for a base64 data: URI right before rasterizing, so the
 *  HTML we persist to print_jobs stays small instead of storing the logo bytes
 *  on every order. */
export const LOGO_PLACEHOLDER = '{{LOGO_SRC}}';

const ESC = 0x1b;
const GS = 0x1d;
const CMD_INIT = Buffer.from([ESC, 0x40]); // ESC @ : reset to defaults
// Codepage 16 = WPC1252 on most ESC/POS clone controllers, which covers the
// Spanish accents used across the menu (á é í ó ú ñ Ñ ¿ ¡). If this specific
// printer's firmware maps codepage numbers differently, adjust here.
const CMD_SELECT_CODEPAGE = Buffer.from([ESC, 0x74, 16]); // ESC t 16
// Double size (both width and height) for the kitchen ticket: proportional
// scaling keeps each glyph's normal shape, just bigger - unlike height-only
// scaling, which stretches letters tall and thin and reads as garbled/oddly
// spaced. Doubling the width halves the usable columns per line to 24
// (TICKET_TEXT_WIDTH), which renderKitchenTicket wraps to.
// GS ! n : low nibble = height multiplier - 1, high nibble = width multiplier - 1.
const CMD_TEXT_DOUBLE = Buffer.from([GS, 0x21, 0x11]); // GS ! 0x11 -> 2x width, 2x height
const CMD_TEXT_NORMAL = Buffer.from([GS, 0x21, 0x00]); // GS ! 0
const CMD_FEED_4 = Buffer.from([ESC, 0x64, 4]); // ESC d 4 : feed 4 lines
const CMD_CUT_PARTIAL = Buffer.from([GS, 0x56, 1]); // GS V 1 : partial cut
// Cap each raster command's row count so a tall bill doesn't ask a cheap
// controller to buffer the whole image in one GS v 0 chunk.
const RASTER_BAND_ROWS = 200;

/**
 * Strips control bytes (keeping \n for line breaks) so order-supplied text
 * (customer name, notes) can't inject raw ESC/POS command bytes into the
 * printer stream.
 */
function sanitizeForPrint(text: string): string {
  return text.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
}

// Print output (ticket + bill) is Spanish but deliberately accent-free; only
// the menu API keeps full accents. Spells out accented Spanish characters in
// plain ASCII.
const ASCII_FOLD: Record<string, string> = {
  á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', ü: 'u',
  Á: 'A', É: 'E', Í: 'I', Ó: 'O', Ú: 'U', Ñ: 'N', Ü: 'U',
  '¿': '', '¡': '',
};
export function toAsciiText(text: string): string {
  return text.replace(/[áéíóúñüÁÉÍÓÚÑÜ¿¡]/g, (ch) => ASCII_FOLD[ch]);
}

function writeToDevice(payload: Buffer): void {
  execFileSync('lp', ['-d', CUPS_PRINTER_QUEUE, '-o', 'raw'], { input: payload });
}

// ---------------------------------------------------------------------------
// Persistence: one saved copy per (order, kind), so tickets/bills can be
// reprinted later without re-deriving them from order/menu state.
// ---------------------------------------------------------------------------

const upsertPrintJob = db.prepare<[number, PrintJobKind, string]>(
  `INSERT INTO print_jobs (order_id, kind, content) VALUES (?, ?, ?)
   ON CONFLICT(order_id, kind) DO UPDATE SET content = excluded.content, created_at = excluded.created_at`
);
const getPrintJob = db.prepare<[number, PrintJobKind], PrintJobRow>(
  'SELECT * FROM print_jobs WHERE order_id = ? AND kind = ?'
);

function savePrintJob(orderId: number, kind: PrintJobKind, content: string): void {
  upsertPrintJob.run(orderId, kind, content);
}

// ---------------------------------------------------------------------------
// Plain-text printing (kitchen ticket)
// ---------------------------------------------------------------------------

function buildTextPayload(text: string, copies: number): Buffer {
  const body = Buffer.concat([
    CMD_SELECT_CODEPAGE,
    CMD_TEXT_DOUBLE,
    Buffer.from(sanitizeForPrint(text), 'latin1'),
    CMD_TEXT_NORMAL,
    CMD_FEED_4,
    CMD_CUT_PARTIAL,
  ]);
  return Buffer.concat([CMD_INIT, ...Array(copies).fill(body)]);
}

function printText(orderId: number, kind: PrintJobKind, text: string, copies = 1): void {
  writeToDevice(buildTextPayload(text, copies));
  console.log(`[printer:thermal-80mm] printed '${kind}' for order ${orderId} (${copies}x)`);
}

export function formatMoney(cop: number): string {
  return `$${cop.toLocaleString('es-CO')}`;
}

const BOGOTA_TZ = 'America/Bogota';
const bogotaDateTimeFormat = new Intl.DateTimeFormat('es-CO', {
  timeZone: BOGOTA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Renders a stored UTC timestamp (e.g. order.createdAt) in Colombia local time for print output. */
export function formatDateTimeCO(isoUtc: string): string {
  return bogotaDateTimeFormat.format(new Date(isoUtc));
}

export function centerText(text: string, width: number = RECEIPT_WIDTH): string {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text;
}

// Order data stores English keys (the stable API contract - see OrderItem in
// dinapoly-types.ts); printed output shows the Spanish `name` text the same
// DB columns the menu API serves (accents get stripped separately via
// toAsciiText for the ticket, kept as-is for the bill and the menu API).
const getCategoryName = db.prepare<[string], { name: string }>('SELECT name FROM categories WHERE key = ?');
const getProductName = db.prepare<[string, string], { name: string }>(
  `SELECT p.name FROM products p JOIN categories c ON c.id = p.category_id WHERE c.key = ? AND p.key = ?`
);
const getProductSizeName = db.prepare<[string, string], { name: string }>(
  `SELECT ps.name FROM product_sizes ps JOIN products p ON p.id = ps.product_id WHERE p.key = ? AND ps.key = ?`
);
const getProductOptionName = db.prepare<[string, string], { name: string }>(
  `SELECT po.name FROM product_options po JOIN products p ON p.id = po.product_id WHERE p.key = ? AND po.key = ?`
);
const getPizzaGroupName = db.prepare<[string], { name: string }>('SELECT name FROM pizza_groups WHERE key = ?');
const getPizzaSizeName = db.prepare<[string], { name: string }>('SELECT name FROM pizza_sizes WHERE key = ?');
const getPizzaFlavorName = db.prepare<[string], { name: string }>('SELECT name FROM pizza_flavors WHERE key = ?');

const ORDER_TYPE_ES: Record<Order['orderType'], string> = {
  dine_in: 'En mesa',
  takeaway: 'Para llevar',
  delivery: 'Domicilio',
};
const PAYMENT_METHOD_ES: Record<NonNullable<Order['paymentMethod']>, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
};

export function describeOrderType(orderType: Order['orderType']): string {
  return ORDER_TYPE_ES[orderType];
}

export function describePaymentMethod(method: NonNullable<Order['paymentMethod']>): string {
  return PAYMENT_METHOD_ES[method];
}

export function describeItem(item: OrderItem): string {
  if (item.pizzaRef) {
    const groupName = getPizzaGroupName.get(item.pizzaRef.group)?.name ?? item.pizzaRef.group;
    const sizeName = getPizzaSizeName.get(item.pizzaRef.size)?.name ?? item.pizzaRef.size;
    const flavorNames = item.pizzaRef.flavors.map((key) => getPizzaFlavorName.get(key)?.name ?? key);
    return `Pizza ${groupName} ${sizeName} (${flavorNames.join(', ')})`;
  }
  const ref = item.menuItemRef!;
  const categoryName = getCategoryName.get(ref.category)?.name ?? ref.category;
  const productName = getProductName.get(ref.category, ref.product)?.name ?? ref.product;
  const bits = [productName];
  if (ref.size) bits.push(`(${getProductSizeName.get(ref.product, ref.size)?.name ?? ref.size})`);
  if (ref.option) bits.push(`- ${getProductOptionName.get(ref.product, ref.option)?.name ?? ref.option}`);
  if (ref.pizzaFlavor) bits.push(`- sabor: ${getPizzaFlavorName.get(ref.pizzaFlavor)?.name ?? ref.pizzaFlavor}`);
  return `${categoryName} - ${bits.join(' ')}`;
}

/**
 * Greedy word-wrap: never splits a word mid-way (unlike the printer's own
 * hard character-wrap), so words don't get cut across the line boundary.
 * A single word longer than `width` still has to hard-split - there's no
 * other option at a fixed physical column count.
 */
function wordWrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.flatMap((line) => {
    if (line.length <= width) return [line];
    const chunks: string[] = [];
    for (let i = 0; i < line.length; i += width) chunks.push(line.slice(i, i + width));
    return chunks;
  });
}

/**
 * Ticket-specific item rendering: unlike describeItem's single-string form
 * (fine for the bill, where CSS wraps at word boundaries automatically),
 * the fixed-width plain-text ticket needs the flavor list broken onto its
 * own line(s) so it doesn't run into (and get cut mid-word against) the
 * pizza's group/size line.
 */
function describeItemTicketLines(item: OrderItem, width: number): string[] {
  if (item.pizzaRef) {
    const groupName = getPizzaGroupName.get(item.pizzaRef.group)?.name ?? item.pizzaRef.group;
    const sizeName = getPizzaSizeName.get(item.pizzaRef.size)?.name ?? item.pizzaRef.size;
    const flavorNames = item.pizzaRef.flavors.map((key) => getPizzaFlavorName.get(key)?.name ?? key);
    return [...wordWrap(`Pizza ${groupName} ${sizeName}`, width), ...wordWrap(flavorNames.join(', '), width)];
  }
  return wordWrap(describeItem(item), width);
}

export function renderKitchenTicket(order: Order): string {
  const width = TICKET_TEXT_WIDTH;
  const lines: string[] = [];

  // Wraps "Label: value" as a whole so long values (customer names,
  // addresses, notes) break at word boundaries instead of the printer
  // cutting mid-word at the fixed column count.
  const pushLabeled = (label: string, value: string) => lines.push(...wordWrap(`${label}: ${value}`, width));

  lines.push(centerText('DINAPOLI PIZZA', width));
  lines.push(centerText('COMANDA', width));
  lines.push(`Orden #${order.id}`);
  lines.push(`${describeOrderType(order.orderType)}`);
  if (order.tableNumber) lines.push(`Mesa: ${order.tableNumber}`);
  if (order.customerName) pushLabeled('Cliente', order.customerName);
  if (order.phone) pushLabeled('Tel', order.phone);
  if (order.address) pushLabeled('Dir', order.address);
  pushLabeled('Fecha', formatDateTimeCO(order.createdAt));
  lines.push('-'.repeat(width));
  for (const item of order.items) {
    const [firstLine, ...restLines] = describeItemTicketLines(item, width - 3);
    lines.push(`${item.quantity}x ${firstLine}`);
    for (const line of restLines) lines.push(`   ${line}`);
    if (item.notes) {
      for (const line of wordWrap(`nota: ${item.notes}`, width - 3)) lines.push(`   ${line}`);
    }
  }
  if (order.notes) {
    lines.push('-'.repeat(width));
    pushLabeled('Notas', order.notes);
  }
  lines.push('='.repeat(width));
  return toAsciiText(lines.join('\n'));
}

// Two physical copies of the same ticket: one stays in the kitchen, one goes
// to the cashier - same order information on both.
const KITCHEN_TICKET_COPIES = 2;

export function printKitchenTicket(order: Order): void {
  const text = renderKitchenTicket(order);
  savePrintJob(order.id, 'kitchen_ticket', text);
  printText(order.id, 'kitchen_ticket', text, KITCHEN_TICKET_COPIES);
}

// ---------------------------------------------------------------------------
// HTML -> rasterized image printing (bill)
// ---------------------------------------------------------------------------

let browserPromise: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  }
  return browserPromise;
}

let logoDataUri: string | null = null;
function getLogoDataUri(): string {
  if (!logoDataUri) {
    logoDataUri = `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
  }
  return logoDataUri;
}

// A tall initial viewport plus a clipped (non-fullPage) screenshot avoids a
// Chromium stitching bug where `fullPage: true` can capture overlapping
// tiles - and repeat content - if layout shifts while a large embedded image
// decodes between tiles. That same race can still hit the clipped screenshot
// if the logo <img> hasn't finished decoding by the time we measure/capture -
// `waitUntil: 'load'` alone isn't a strong enough guarantee - so we
// explicitly wait on every image's decode() first.
const MAX_RECEIPT_HEIGHT_PX = 4000;

// Callbacks below run inside the browser page context (not Node), where
// `document`/`Image` are that context's DOM globals - deliberately untyped
// via this cast rather than pulling the "dom" lib into this Node project's
// whole type space.
type BrowserGlobal = {
  document: {
    body: { scrollHeight: number };
    images: Iterable<{ decode(): Promise<void> }>;
  };
};

async function renderHtmlToPng(html: string): Promise<Buffer> {
  const resolvedHtml = html.split(LOGO_PLACEHOLDER).join(getLogoDataUri());
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: RECEIPT_WIDTH_PX, height: MAX_RECEIPT_HEIGHT_PX, deviceScaleFactor: 1 });
    await page.setContent(resolvedHtml, { waitUntil: 'load' });
    // `waitUntil: 'load'` alone isn't a strong enough guarantee that the
    // embedded base64 logo has finished decoding - without this, the layout
    // shift from a late decode can hit Chromium's tile-stitching bug and
    // produce a screenshot with repeated content.
    await page.evaluate(() => {
      const doc = (globalThis as unknown as BrowserGlobal).document;
      return Promise.all(Array.from(doc.images).map((img) => img.decode()));
    });
    const contentHeight = await page.evaluate(
      () => (globalThis as unknown as BrowserGlobal).document.body.scrollHeight
    );
    return Buffer.from(
      await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width: RECEIPT_WIDTH_PX, height: Math.min(contentHeight, MAX_RECEIPT_HEIGHT_PX) },
      })
    );
  } finally {
    await page.close();
  }
}

/** Floyd-Steinberg dither to 1-bit-per-pixel, MSB-first, packed rows (white background composite). */
function ditherToBits(png: PNG): { height: number; bytesPerRow: number; bits: Uint8Array } {
  const { width, height, data } = png;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[i] = a * lum + (1 - a) * 255;
  }

  const bytesPerRow = Math.ceil(width / 8);
  const bits = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const old = gray[idx];
      const black = old < 128;
      if (black) {
        bits[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
      const err = old - (black ? 0 : 255);
      if (x + 1 < width) gray[idx + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) gray[idx + width - 1] += (err * 3) / 16;
        gray[idx + width] += (err * 5) / 16;
        if (x + 1 < width) gray[idx + width + 1] += (err * 1) / 16;
      }
    }
  }

  return { height, bytesPerRow, bits };
}

function buildRasterPayload(png: PNG): Buffer {
  const { height, bytesPerRow, bits } = ditherToBits(png);
  const chunks: Buffer[] = [CMD_INIT];

  for (let y0 = 0; y0 < height; y0 += RASTER_BAND_ROWS) {
    const bandHeight = Math.min(RASTER_BAND_ROWS, height - y0);
    const header = Buffer.from([
      GS,
      0x76,
      0x30,
      0x00,
      bytesPerRow & 0xff,
      (bytesPerRow >> 8) & 0xff,
      bandHeight & 0xff,
      (bandHeight >> 8) & 0xff,
    ]);
    const band = Buffer.from(bits.buffer, bits.byteOffset + y0 * bytesPerRow, bandHeight * bytesPerRow);
    chunks.push(header, Buffer.from(band));
  }

  chunks.push(CMD_FEED_4, CMD_CUT_PARTIAL);
  return Buffer.concat(chunks);
}

async function printHtmlAsImage(orderId: number, kind: PrintJobKind, html: string): Promise<void> {
  const pngBuffer = await renderHtmlToPng(html);
  const png = PNG.sync.read(pngBuffer);
  writeToDevice(buildRasterPayload(png));
  console.log(`[printer:thermal-80mm] printed '${kind}' for order ${orderId} (raster ${png.width}x${png.height})`);
}

export async function printBillHtml(orderId: number, html: string): Promise<void> {
  savePrintJob(orderId, 'bill', html);
  await printHtmlAsImage(orderId, 'bill', html);
}

// ---------------------------------------------------------------------------
// Reprinting
// ---------------------------------------------------------------------------

export async function reprintJob(orderId: number, kind: PrintJobKind): Promise<void> {
  const row = getPrintJob.get(orderId, kind);
  if (!row) {
    throw new NotFoundError(`no saved '${kind}' to reprint for order ${orderId}`);
  }
  if (kind === 'kitchen_ticket') {
    printText(orderId, kind, row.content, KITCHEN_TICKET_COPIES);
  } else {
    await printHtmlAsImage(orderId, kind, row.content);
  }
}
