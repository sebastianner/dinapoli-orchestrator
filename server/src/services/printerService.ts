import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import puppeteer, { type Browser } from "puppeteer";
import { PNG } from "pngjs";
import db from "../db/index.js";
import { NotFoundError } from "../utils/errors.js";
import { BUSINESS_DAY_SQL_OFFSET } from "../utils/date.js";
import type {
  Order,
  OrderItem,
  PaymentMethod,
  PromoType,
} from "../types/dinapoly-types.js";
import type { PrintJobKind, PrintJobRow } from "../types/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 80mm paper, Font A (12 dots/char on a 576-dot head) -> 48 columns/line at
// normal size (used for the bill's pixel width). The kitchen ticket prints at
// double size (see CMD_TEXT_DOUBLE below) so each character is twice as wide,
// halving the usable columns per line to 24.
export const RECEIPT_WIDTH = 48;
export const RECEIPT_WIDTH_PX = RECEIPT_WIDTH * 12;
const TICKET_TEXT_WIDTH = RECEIPT_WIDTH / 2;

// Two physical printers, each reached through its own OS print queue rather
// than a raw device path (e.g. /dev/usb/lp* or a Windows USB00x port): on
// Linux the underlying CUPS USB backend claims the device via libusb
// (detaching the kernel's usblp driver) as soon as it probes it, which makes
// a raw device node come and go unpredictably - going through the OS's own
// print spooler is what actually owns the printer reliably on either
// platform. See writeToDevice/ensurePrinterEnabled below for the actual
// per-OS dispatch (CUPS's `lp -o raw` on Linux/macOS, WinSpool RAW writes via
// print-raw.ps1 on Windows) - both send our ESC/POS bytes to the printer
// completely unfiltered, bypassing any driver-side rendering.
//
// Routing: the kitchen comanda (and its addendum) goes to kitchen_printer.
// The customer bill goes to counter_printer. A delivery order's comanda copy
// printed again at close time also goes to counter_printer (it travels out
// with the driver/bill, not back to the kitchen) - see
// printDeliveryComandaCopy.
//
// On Windows, set these to the exact printer name shown in Settings ->
// Printers & scanners (install the printer there first, any driver is fine
// since we always print RAW - "Generic / Text Only" is a safe default if the
// printer has no vendor driver). On Linux, they're CUPS queue names (see
// `lpstat -v`).
const KITCHEN_PRINTER_QUEUE = process.env.KITCHEN_PRINTER_QUEUE ?? "kitchen_printer";
const COUNTER_PRINTER_QUEUE = process.env.COUNTER_PRINTER_QUEUE ?? "counter_printer";

const execFileAsync = promisify(execFile);

const IS_WINDOWS = process.platform === "win32";
// How often the print queues are un-paused. See ensurePrinterEnabled for why
// this is a timer rather than something that runs before each job.
const PRINTER_MAINTENANCE_INTERVAL_MS = 30_000;
const WINDOWS_RAW_PRINT_SCRIPT = path.resolve(__dirname, "../assets/print-raw.ps1");

const LOGO_PATH = path.resolve(__dirname, "../assets/dinapoli_pizza_logo.png");
/** Placeholder swapped for a base64 data: URI right before rasterizing, so the
 *  HTML we persist to print_jobs stays small instead of storing the logo bytes
 *  on every order. */
export const LOGO_PLACEHOLDER = "{{LOGO_SRC}}";

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
// Height-only double for the closing report: unlike the kitchen ticket, its
// column layout (see endOfDayService's moneyRow/centerText) is padded to a
// fixed 48-char width, so doubling width too would overflow the 80mm paper
// and force the printer to hard-wrap mid-line, destroying the alignment.
// Height-only keeps all 48 columns intact while still printing noticeably
// bigger than normal size.
const CMD_TEXT_DOUBLE_HEIGHT = Buffer.from([GS, 0x21, 0x01]); // GS ! 0x01 -> 1x width, 2x height
const CMD_TEXT_NORMAL = Buffer.from([GS, 0x21, 0x00]); // GS ! 0
// Extra gap (in dots) added to the right of every character - closing report
// only, for readability. Chosen over doubling width (like the kitchen ticket)
// for the same reason as CMD_TEXT_DOUBLE_HEIGHT above: the fixed 48-col
// padded layout would overflow 80mm paper if each glyph got twice as wide.
// A few extra dots per character instead widens the line only slightly, no
// overflow/wrap risk. Tune the value if it still reads cramped on the actual
// printer - it's in printer dots, not points, so how big 2 looks is
// hardware-dependent.
const CMD_CHAR_SPACING = Buffer.from([ESC, 0x20, 2]); // ESC SP 2
const CMD_CHAR_SPACING_RESET = Buffer.from([ESC, 0x20, 0]); // ESC SP 0
const CMD_FEED_4 = Buffer.from([ESC, 0x64, 4]); // ESC d 4 : feed 4 lines
const CMD_CUT_PARTIAL = Buffer.from([GS, 0x56, 1]); // GS V 1 : partial cut
const CMD_BOLD_ON = Buffer.from([ESC, 0x45, 1]); // ESC E 1 : emphasized (bold) on
const CMD_BOLD_OFF = Buffer.from([ESC, 0x45, 0]); // ESC E 0 : emphasized (bold) off
// Cap each raster command's row count so a tall bill doesn't ask a cheap
// controller to buffer the whole image in one GS v 0 chunk.
const RASTER_BAND_ROWS = 200;

/**
 * Strips control bytes (keeping \n for line breaks) so order-supplied text
 * (customer name, notes) can't inject raw ESC/POS command bytes into the
 * printer stream.
 */
function sanitizeForPrint(text: string): string {
  return text.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, "");
}

// Bold-toggle markers embedded in ticket text by renderKitchenTicket/
// renderKitchenTicketAddendum - only ever wrapped around server-computed
// values (order type, table number), never user-supplied fields (customer
// name, notes, address), so there's no injection path through order data.
// Picked from the Unicode Private Use Area specifically so they (a) can
// never collide with real menu/customer text and (b) fall outside
// sanitizeForPrint's stripped range, so they survive it untouched - the
// actual ESC E n bold bytes are only spliced in afterwards, in
// encodeTicketText, downstream of sanitization rather than before it.
const BOLD_ON_MARKER = "\uE000";
const BOLD_OFF_MARKER = "\uE001";
export function boldText(text: string): string {
  return `${BOLD_ON_MARKER}${text}${BOLD_OFF_MARKER}`;
}
const BOLD_MARKER_SPLIT = new RegExp(`(${BOLD_ON_MARKER}|${BOLD_OFF_MARKER})`);

/** Sanitizes text, then splices in real ESC E bold-toggle bytes wherever a
 *  boldText() marker survived - see BOLD_ON_MARKER/BOLD_OFF_MARKER above. */
function encodeTicketText(text: string): Buffer {
  const parts = sanitizeForPrint(text).split(BOLD_MARKER_SPLIT);
  const buffers: Buffer[] = [];
  for (const part of parts) {
    if (part === BOLD_ON_MARKER) buffers.push(CMD_BOLD_ON);
    else if (part === BOLD_OFF_MARKER) buffers.push(CMD_BOLD_OFF);
    else if (part) buffers.push(Buffer.from(part, "latin1"));
  }
  return Buffer.concat(buffers);
}

// Print output (ticket + bill) is Spanish but deliberately accent-free; only
// the menu API keeps full accents. Spells out accented Spanish characters in
// plain ASCII.
const ASCII_FOLD: Record<string, string> = {
  á: "a",
  é: "e",
  í: "i",
  ó: "o",
  ú: "u",
  ñ: "n",
  ü: "u",
  Á: "A",
  É: "E",
  Í: "I",
  Ó: "O",
  Ú: "U",
  Ñ: "N",
  Ü: "U",
  "¿": "",
  "¡": "",
};
export function toAsciiText(text: string): string {
  return text.replace(/[áéíóúñüÁÉÍÓÚÑÜ¿¡]/g, (ch) => ASCII_FOLD[ch]);
}

/**
 * Either CUPS queue (Linux/macOS) or Windows print queue has been observed
 * going into a disabled/paused state on its own (backend/USB hiccup, reason
 * unknown) - a disabled CUPS queue still *accepts* jobs (`lp` exits 0), it
 * just leaves them stuck in the spool without ever sending them to the
 * printer; a paused Windows queue behaves the same way. That means nothing
 * downstream (writeToDevice throwing, the kitchen-ticket retry queue,
 * completeOrder's try/catch) ever notices the job didn't actually print -
 * orders/receipts silently stop coming out with no error anywhere.
 *
 * Note this can only ever be *periodic* self-healing, never reactive: since a
 * paused queue accepts the job without error, there is no failure to react to.
 * It runs on a timer (see startPrinterMaintenance) rather than before every
 * job, which is what it used to do - `Resume-Printer` costs ~566ms of process
 * startup and CIM module loading, and paying that per ticket made it more than
 * half the cost of printing. Nothing is lost by resuming late: a job spooled
 * against a paused queue sits there and flushes the moment it resumes.
 */
async function ensurePrinterEnabled(queue: string): Promise<void> {
  try {
    if (IS_WINDOWS) {
      // Resume-Printer ships with Windows' built-in PrintManagement module
      // (Windows 8+ / Server 2012+) - no extra install needed. Quoting the
      // name defensively even though it only ever comes from our own env
      // vars, never user input.
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Resume-Printer -Name '${queue.replace(/'/g, "''")}'`,
      ]);
    } else {
      await execFileAsync("cupsenable", [queue]);
    }
  } catch (err) {
    console.error(
      `[printer:thermal-80mm] failed to ensure '${queue}' is enabled:`,
      (err as Error).message,
    );
  }
}

let maintenanceHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Keeps both print queues un-paused, on a timer and off the printing hot path.
 * Called from server.ts alongside the queue worker. Worst case after a queue
 * pauses itself is one interval of tickets sitting spooled, then all of them
 * printing at once - versus paying the resume cost on every single ticket.
 */
export function startPrinterMaintenance(): void {
  if (PRINTER_EMULATION_DIR) return; // nothing to resume
  const sweep = () => {
    for (const queue of new Set([KITCHEN_PRINTER_QUEUE, COUNTER_PRINTER_QUEUE])) {
      void ensurePrinterEnabled(queue);
    }
  };
  sweep(); // one pass at boot, so the first ticket of the night isn't the one that waits
  maintenanceHandle = setInterval(sweep, PRINTER_MAINTENANCE_INTERVAL_MS);
  console.log(`[printer:thermal-80mm] queue maintenance started (every ${PRINTER_MAINTENANCE_INTERVAL_MS}ms)`);
}

export function stopPrinterMaintenance(): void {
  if (maintenanceHandle) clearInterval(maintenanceHandle);
  maintenanceHandle = null;
}

async function writeToDeviceWindows(payload: Buffer, queue: string): Promise<void> {
  // WinSpool (unlike CUPS's `lp`) has no "pipe bytes in via stdin" story, so
  // the payload goes to a scratch file first and print-raw.ps1 (a WritePrinter
  // P/Invoke wrapper, see server/src/assets/print-raw.ps1) reads it back and
  // sends it to the named queue with datatype RAW - the Windows equivalent
  // of `lp -o raw`, bypassing driver-side rendering entirely.
  const tempFile = path.join(os.tmpdir(), `dinapoli-print-${randomUUID()}.bin`);
  await fs.promises.writeFile(tempFile, payload);
  try {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      WINDOWS_RAW_PRINT_SCRIPT,
      "-PrinterName",
      queue,
      "-FilePath",
      tempFile,
    ]);
  } finally {
    await fs.promises.rm(tempFile, { force: true }).catch(() => {
      // best-effort cleanup of the scratch payload
    });
  }
}

/** `lp` takes the payload on stdin; the async execFile has no `input` option, so it's piped by hand. */
function writeToDeviceCups(payload: Buffer, queue: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile("lp", ["-d", queue, "-o", "raw"], (err) => (err ? reject(err) : resolve()));
    // A child that dies before reading stdin turns the write into EPIPE; the
    // exec callback above already carries the real failure, so don't let the
    // stream error double-reject.
    child.stdin?.on("error", () => {});
    child.stdin?.end(payload);
  });
}

// ---------------------------------------------------------------------------
// Emulated printer (no hardware attached)
// ---------------------------------------------------------------------------
//
// Set PRINTER_EMULATION_DIR to a directory and every job that would go to a
// physical queue is written there instead: the exact ESC/POS byte stream as
// `<seq>-<queue>-<kind>.bin`, plus a human-readable decode of it as `.txt`
// (control sequences stripped/annotated). Raster jobs additionally drop the
// pre-dither PNG next to them (see printHtmlAsImage). Nothing else changes -
// the same payload builders, the same call sites, the same failure semantics -
// so this exercises the whole print path end to end with no printer present.
const PRINTER_EMULATION_DIR = process.env.PRINTER_EMULATION_DIR ?? null;
let emulatedJobSeq: number | null = null;

/** Resumes numbering after the highest job already in the directory, so a server restart appends to the spool instead of overwriting it from 0001. */
function nextEmulatedJobPath(queue: string, extension: string): string {
  if (emulatedJobSeq == null) {
    const existing = fs.existsSync(PRINTER_EMULATION_DIR!)
      ? fs.readdirSync(PRINTER_EMULATION_DIR!).map((f) => Number(f.slice(0, 5))).filter((n) => Number.isInteger(n))
      : [];
    emulatedJobSeq = existing.length ? Math.max(...existing) : 0;
  }
  emulatedJobSeq += 1;
  const seq = String(emulatedJobSeq).padStart(5, "0");
  return path.join(PRINTER_EMULATION_DIR!, `${seq}-${queue}.${extension}`);
}

/**
 * Turns an ESC/POS payload back into something readable: raster bands become a
 * one-line summary, every other command becomes a `<TAG>` marker, and the
 * printable bytes come through as latin1 text (which is how they were encoded).
 */
function decodeEscPos(payload: Buffer): string {
  let out = "";
  let i = 0;
  while (i < payload.length) {
    const b = payload[i];
    if (b === ESC && payload[i + 1] === 0x40) { out += "<INIT>\n"; i += 2; continue; }
    if (b === ESC && payload[i + 1] === 0x74) { out += `<CODEPAGE ${payload[i + 2]}>\n`; i += 3; continue; }
    if (b === ESC && payload[i + 1] === 0x20) { out += `<CHAR-SPACING ${payload[i + 2]}>\n`; i += 3; continue; }
    if (b === ESC && payload[i + 1] === 0x45) { out += payload[i + 2] ? "<B>" : "</B>"; i += 3; continue; }
    if (b === ESC && payload[i + 1] === 0x64) { out += `\n<FEED ${payload[i + 2]}>\n`; i += 3; continue; }
    if (b === GS && payload[i + 1] === 0x21) { out += `<SIZE 0x${payload[i + 2].toString(16).padStart(2, "0")}>\n`; i += 3; continue; }
    if (b === GS && payload[i + 1] === 0x56) { out += `<CUT>\n`; i += 3; continue; }
    if (b === GS && payload[i + 1] === 0x76 && payload[i + 2] === 0x30) {
      const bytesPerRow = payload[i + 4] | (payload[i + 5] << 8);
      const rows = payload[i + 6] | (payload[i + 7] << 8);
      out += `<RASTER ${bytesPerRow * 8}px x ${rows}px>\n`;
      i += 8 + bytesPerRow * rows;
      continue;
    }
    out += Buffer.from([b]).toString("latin1");
    i += 1;
  }
  return out;
}

// Writing a file is effectively instant, while a real printer costs real time
// (~1s per ticket on Windows, measured). Set this to model that cost against
// the emulated printer so the knock-on effect on everything else the server is
// doing can be measured without hardware. Unset (the default) is instant.
//
// The wait is asynchronous, matching how the real path now behaves: the cost is
// a child process, which the OS runs while this event loop stays free.
// PRINTER_EMULATION_BLOCKING=1 makes it a *synchronous* block instead, which is
// what execFileSync used to do - kept so the original pathology can still be
// reproduced on demand and the regression test can prove it detects it.
const PRINTER_EMULATION_DELAY_MS = Number(process.env.PRINTER_EMULATION_DELAY_MS ?? 0);
const PRINTER_EMULATION_BLOCKING = process.env.PRINTER_EMULATION_BLOCKING === "1";
const blockingSleepBuffer = new Int32Array(new SharedArrayBuffer(4));

/** Blocks the event loop, exactly like execFileSync did - a setTimeout would not reproduce the problem. */
function blockFor(ms: number): void {
  Atomics.wait(blockingSleepBuffer, 0, 0, ms);
}

async function writeToEmulatedPrinter(payload: Buffer, queue: string): Promise<void> {
  fs.mkdirSync(PRINTER_EMULATION_DIR!, { recursive: true });
  const binPath = nextEmulatedJobPath(queue, "bin");
  fs.writeFileSync(binPath, payload);
  fs.writeFileSync(binPath.replace(/\.bin$/, ".txt"), decodeEscPos(payload), "latin1");
  if (PRINTER_EMULATION_DELAY_MS <= 0) return;
  if (PRINTER_EMULATION_BLOCKING) blockFor(PRINTER_EMULATION_DELAY_MS);
  else await new Promise((resolve) => setTimeout(resolve, PRINTER_EMULATION_DELAY_MS));
}

/**
 * Hands the payload to the OS print spooler. Asynchronous on purpose: this
 * used to be execFileSync, which blocks the entire Node event loop - measured
 * at ~1s per ticket on Windows, during which the server answered nothing. No
 * WebSocket ack, no HTTP response, no live update on any screen, for every
 * ticket printed. Nothing here needs to be synchronous: the queue worker
 * already treats a failed print as "leave the row PRINTING and retry next
 * tick", so awaiting is enough.
 */
async function writeToDevice(payload: Buffer, queue: string): Promise<void> {
  if (PRINTER_EMULATION_DIR) {
    await writeToEmulatedPrinter(payload, queue);
    return;
  }
  // Note: no ensurePrinterEnabled() here any more - it runs on a timer
  // instead (startPrinterMaintenance), because it cost more than the printing.
  if (IS_WINDOWS) {
    await writeToDeviceWindows(payload, queue);
    return;
  }
  await writeToDeviceCups(payload, queue);
}

// ---------------------------------------------------------------------------
// Persistence: one saved copy per (order, kind), so tickets/bills can be
// reprinted later without re-deriving them from order/menu state.
// ---------------------------------------------------------------------------

const upsertPrintJob = db.prepare<[number, PrintJobKind, string]>(
  `INSERT INTO print_jobs (order_id, kind, content) VALUES (?, ?, ?)
   ON CONFLICT(order_id, kind) DO UPDATE SET content = excluded.content, created_at = excluded.created_at`,
);

// "Delivery #N of the day" for the kitchen comanda. orders.id is a single
// global AUTOINCREMENT that never resets, so this is its own per-business-day
// sequence, assigned once at creation (orderService.assignDeliveryDayNumber)
// and read back here. It used to be counted live on every render, which meant
// deleting an earlier delivery order silently renumbered every later one - a
// reprint then disagreed with the ticket the kitchen already had.
const getDeliveryDayNumber = db.prepare<[number], { delivery_day_number: number | null }>(
  "SELECT delivery_day_number FROM orders WHERE id = ?",
);
// Fallback for delivery orders created before the column existed (it is NULL
// for those). Same live count as before, 1-indexed via `id <= ?`.
const countEarlierDeliveryOrdersToday = db.prepare<[number, string], { count: number }>(
  `SELECT COUNT(*) AS count FROM orders
   WHERE order_type = 'delivery' AND id <= ? AND date(created_at, '${BUSINESS_DAY_SQL_OFFSET}') = date(?, '${BUSINESS_DAY_SQL_OFFSET}')`,
);

function deliveryOrderNumberOfDay(order: Order): number {
  const stored = getDeliveryDayNumber.get(order.id)?.delivery_day_number;
  if (stored != null) return stored;
  return countEarlierDeliveryOrdersToday.get(order.id, order.createdAt)!.count;
}

const getPrintJob = db.prepare<[number, PrintJobKind], PrintJobRow>(
  "SELECT * FROM print_jobs WHERE order_id = ? AND kind = ?",
);

function savePrintJob(
  orderId: number,
  kind: PrintJobKind,
  content: string,
): void {
  upsertPrintJob.run(orderId, kind, content);
}

// ---------------------------------------------------------------------------
// Plain-text printing (kitchen ticket)
// ---------------------------------------------------------------------------

function buildTextPayload(text: string, copies: number): Buffer {
  const body = Buffer.concat([
    CMD_SELECT_CODEPAGE,
    CMD_TEXT_DOUBLE,
    encodeTicketText(text),
    CMD_TEXT_NORMAL,
    CMD_FEED_4,
    CMD_CUT_PARTIAL,
  ]);
  return Buffer.concat([CMD_INIT, ...Array(copies).fill(body)]);
}

async function printText(
  orderId: number,
  kind: PrintJobKind,
  text: string,
  queue: string,
  copies = 1,
): Promise<void> {
  await writeToDevice(buildTextPayload(text, copies), queue);
  console.log(
    `[printer:thermal-80mm] printed '${kind}' for order ${orderId} (${copies}x)`,
  );
}

// Height-only double (not the kitchen ticket's full 2x2) - this is a dense
// operational report whose column layout depends on fitting all 48 chars
// per line (see CMD_TEXT_DOUBLE_HEIGHT), so width stays normal while height
// still prints noticeably bigger than the old fully-normal size.
function buildPlainTextPayload(text: string): Buffer {
  return Buffer.concat([
    CMD_INIT,
    CMD_SELECT_CODEPAGE,
    CMD_CHAR_SPACING,
    CMD_TEXT_DOUBLE_HEIGHT,
    Buffer.from(sanitizeForPrint(text), "latin1"),
    CMD_TEXT_NORMAL,
    CMD_CHAR_SPACING_RESET,
    CMD_FEED_4,
    CMD_CUT_PARTIAL,
  ]);
}

/** Prints an arbitrary plain-text document not tied to a specific order (e.g. the End-of-Day closing receipt) - a cashier/register document, so it goes to counter_printer like the bill. */
export async function printPlainText(text: string): Promise<void> {
  await writeToDevice(buildPlainTextPayload(text), COUNTER_PRINTER_QUEUE);
  console.log("[printer:thermal-80mm] printed plain-text document");
}

export function formatMoney(cop: number): string {
  return `$${cop.toLocaleString("es-CO")}`;
}

const BOGOTA_TZ = "America/Bogota";
const bogotaDateTimeFormat = new Intl.DateTimeFormat("es-CO", {
  timeZone: BOGOTA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const bogotaDateOnlyFormat = new Intl.DateTimeFormat("es-CO", {
  timeZone: BOGOTA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const bogotaTimeOnlyFormat = new Intl.DateTimeFormat("es-CO", {
  timeZone: BOGOTA_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Renders a stored UTC timestamp (e.g. order.createdAt) in Colombia local time for print output. */
export function formatDateTimeCO(isoUtc: string): string {
  return bogotaDateTimeFormat.format(new Date(isoUtc));
}

/**
 * Date and time separately, for the kitchen ticket. "Fecha: 01/08/2026, 19:16:56"
 * is 27 characters against a 24-column double-width line, so it always wrapped
 * mid-timestamp; two short labelled lines never do. Seconds are dropped - the
 * kitchen cares what minute an order came in, not what second.
 */
export function formatDateCO(isoUtc: string): string {
  return bogotaDateOnlyFormat.format(new Date(isoUtc));
}
export function formatTimeCO(isoUtc: string): string {
  return bogotaTimeOnlyFormat.format(new Date(isoUtc));
}

export function centerText(
  text: string,
  width: number = RECEIPT_WIDTH,
): string {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  return " ".repeat(left) + text;
}

// Order data stores English keys (the stable API contract - see OrderItem in
// dinapoly-types.ts); printed output shows the Spanish `name` text the same
// DB columns the menu API serves (accents get stripped separately via
// toAsciiText for the ticket, kept as-is for the bill and the menu API).
const getCategoryName = db.prepare<[string], { name: string }>(
  "SELECT name FROM categories WHERE key = ?",
);
const getProductName = db.prepare<[string, string], { name: string }>(
  `SELECT p.name FROM products p JOIN categories c ON c.id = p.category_id WHERE c.key = ? AND p.key = ?`,
);
const getProductSizeName = db.prepare<[string, string], { name: string }>(
  `SELECT ps.name FROM product_sizes ps JOIN products p ON p.id = ps.product_id WHERE p.key = ? AND ps.key = ?`,
);
// Unlike product sizes/options used to be, a flavor key is globally unique
// (shared across products, see schema.sql's drink_flavors), so no product
// join is needed to look it up.
const getDrinkFlavorName = db.prepare<[string], { name: string }>(
  "SELECT name FROM drink_flavors WHERE key = ?",
);
const getPizzaGroupName = db.prepare<[string], { name: string }>(
  "SELECT name FROM pizza_groups WHERE key = ?",
);
const getPizzaSizeName = db.prepare<[string], { name: string }>(
  "SELECT name FROM pizza_sizes WHERE key = ?",
);
const getPizzaFlavorName = db.prepare<[string], { name: string }>(
  "SELECT name FROM pizza_flavors WHERE key = ?",
);

const ORDER_TYPE_ES: Record<Order["orderType"], string> = {
  dine_in: "En mesa",
  takeaway: "Para llevar",
  delivery: "Domicilio",
};
const PAYMENT_METHOD_ES: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  rappi: "Rappi",
};
const PROMO_LABEL_ES: Record<PromoType, string> = {
  duo: "PROMO DUO",
  pizza_xl: "PROMO PIZZA XL",
};

export function describeOrderType(orderType: Order["orderType"]): string {
  return ORDER_TYPE_ES[orderType];
}

/**
 * One label per promo instance on the order (an order can carry several -
 * see Order.promos), e.g. "PROMO DUO ($37.000)". basePrice is already
 * derived server-side (orderService.buildOrderPromos) from that instance's
 * own item snapshot rather than the currently-configured price, so a
 * reprinted/historical ticket always matches what was actually charged.
 */
export function describePromos(order: Order): string[] {
  return order.promos.map((p) => `${PROMO_LABEL_ES[p.type]} (${formatMoney(p.basePrice)})`);
}

export function describePaymentMethod(method: PaymentMethod): string {
  return PAYMENT_METHOD_ES[method];
}

/** Percent -> the simplified fraction it represents, e.g. 25 -> "1/4". Empty for a whole (100%) flavor. */
function formatPortionFraction(portion: number): string {
  if (portion >= 100) return "";
  // 100/3 isn't an integer, so equal thirds are stored as 34/33/33 - still just "1/3" to a reader.
  if (portion === 33 || portion === 34) return "1/3";
  const divisor = gcd(portion, 100);
  return `${portion / divisor}/${100 / divisor}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function describeItem(item: OrderItem): string {
  if (item.pizzaRef) {
    const groupName =
      getPizzaGroupName.get(item.pizzaRef.group)?.name ?? item.pizzaRef.group;
    const sizeName =
      getPizzaSizeName.get(item.pizzaRef.size)?.name ?? item.pizzaRef.size;
    const flavorNames = item.pizzaRef.flavors.map(
      (f) => getPizzaFlavorName.get(f.flavor)?.name ?? f.flavor,
    );
    return `Pizza ${groupName} ${sizeName} (${flavorNames.join(", ")})`;
  }
  const ref = item.menuItemRef!;
  const categoryName = getCategoryName.get(ref.category)?.name ?? ref.category;
  const productName =
    getProductName.get(ref.category, ref.product)?.name ?? ref.product;
  const bits = [productName];
  if (ref.size)
    bits.push(
      `(${getProductSizeName.get(ref.product, ref.size)?.name ?? ref.size})`,
    );
  if (ref.drinkFlavor)
    bits.push(
      `- ${getDrinkFlavorName.get(ref.drinkFlavor)?.name ?? ref.drinkFlavor}`,
    );
  if (ref.pizzaFlavor)
    bits.push(
      `- sabor: ${getPizzaFlavorName.get(ref.pizzaFlavor)?.name ?? ref.pizzaFlavor}`,
    );
  return `${categoryName} - ${bits.join(" ")}`;
}

/**
 * Greedy word-wrap: never splits a word mid-way (unlike the printer's own
 * hard character-wrap), so words don't get cut across the line boundary.
 * A single word longer than `width` still has to hard-split - there's no
 * other option at a fixed physical column count.
 */
function wordWrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
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
    for (let i = 0; i < line.length; i += width)
      chunks.push(line.slice(i, i + width));
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
    const groupName =
      getPizzaGroupName.get(item.pizzaRef.group)?.name ?? item.pizzaRef.group;
    const sizeName =
      getPizzaSizeName.get(item.pizzaRef.size)?.name ?? item.pizzaRef.size;
    const flavorNames = item.pizzaRef.flavors.map((f) => {
      const name = getPizzaFlavorName.get(f.flavor)?.name ?? f.flavor;
      const fraction = formatPortionFraction(f.portion);
      return fraction ? `${name} (${fraction})` : name;
    });
    return [
      ...wordWrap(`Pizza ${groupName} ${sizeName}`, width),
      ...wordWrap(flavorNames.join(", "), width),
    ];
  }
  return wordWrap(describeItem(item), width);
}

/** Ticket-grouping key: items that are identical in every way the kitchen
 *  cares about (same product/pizza, size, flavors, notes) share a key, so
 *  they can be combined into one "Nx ..." line. Deliberately ignores
 *  unitPrice (a promo item priced at 0 still needs the same prep as a
 *  full-price one, and the ticket never prints prices anyway). */
function ticketItemKey(item: OrderItem): string {
  const notesKey = item.notes ?? "";
  if (item.pizzaRef) {
    const flavorsKey = item.pizzaRef.flavors
      .map((f) => `${f.flavor}:${f.portion}`)
      .sort()
      .join(",");
    return `pizza:${item.pizzaRef.group}:${item.pizzaRef.size}:${flavorsKey}:${notesKey}`;
  }
  const ref = item.menuItemRef!;
  return `product:${ref.category}:${ref.product}:${ref.size ?? ""}:${ref.drinkFlavor ?? ""}:${ref.pizzaFlavor ?? ""}:${notesKey}`;
}

/**
 * Merges order items that are identical in every ticket-relevant way into
 * one line with a combined quantity, so ordering the same drink/pizza/
 * product twice prints "2x ..." instead of two separate "1x ..." lines.
 * Presentation-only: doesn't touch the underlying order_items rows, pricing,
 * or any other order view - just what gets printed on the ticket.
 */
function groupItemsForTicket(items: OrderItem[]): OrderItem[] {
  const grouped: OrderItem[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of items) {
    const key = ticketItemKey(item);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, grouped.length);
      grouped.push(item);
    } else {
      grouped[existingIndex] = {
        ...grouped[existingIndex],
        quantity: grouped[existingIndex].quantity + item.quantity,
      };
    }
  }
  return grouped;
}

/** Same idea as groupItemsForTicket, but for the bill: unitPrice IS part of
 *  the key here, since each row needs a single, correct unit price - merging
 *  a full-price item with a differently-priced one (e.g. a duo promo's 0-cost
 *  half) would make that line's price/total wrong. Two lines with the same
 *  description but different unitPrice stay separate rows. */
export function groupItemsForBill(items: OrderItem[]): OrderItem[] {
  const grouped: OrderItem[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of items) {
    const key = `${ticketItemKey(item)}:${item.unitPrice}`;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, grouped.length);
      grouped.push(item);
    } else {
      grouped[existingIndex] = {
        ...grouped[existingIndex],
        quantity: grouped[existingIndex].quantity + item.quantity,
      };
    }
  }
  return grouped;
}

export function renderKitchenTicket(order: Order): string {
  const width = TICKET_TEXT_WIDTH;
  const lines: string[] = [];

  // Wraps "Label: value" as a whole so long values (customer names,
  // addresses, notes) break at word boundaries instead of the printer
  // cutting mid-word at the fixed column count.
  const pushLabeled = (label: string, value: string) =>
    lines.push(...wordWrap(`${label}: ${value}`, width));

  lines.push(centerText("DINAPOLI PIZZA", width));
  lines.push(centerText("COMANDA", width));
  lines.push(`Orden #${order.id}`);
  const orderTypeLine =
    order.orderType === "delivery"
      ? `${describeOrderType(order.orderType)} #${deliveryOrderNumberOfDay(order)}`
      : describeOrderType(order.orderType);
  lines.push(boldText(orderTypeLine));
  for (const line of describePromos(order)) lines.push(centerText(line, width));
  if (order.tableNumber) lines.push(boldText(`Mesa: ${order.tableNumber}`));
  if (order.customerName) pushLabeled("Cliente", order.customerName);
  if (order.phone) pushLabeled("Tel", order.phone);
  if (order.address) pushLabeled("Dir", order.address);
  lines.push(`Fecha: ${formatDateCO(order.createdAt)}`);
  lines.push(`Hora: ${formatTimeCO(order.createdAt)}`);
  lines.push("-".repeat(width));
  for (const item of groupItemsForTicket(order.items)) {
    const [firstLine, ...restLines] = describeItemTicketLines(item, width - 3);
    lines.push(`${item.quantity}x ${firstLine}`);
    for (const line of restLines) lines.push(`   ${line}`);
    if (item.notes) {
      for (const line of wordWrap(`nota: ${item.notes}`, width - 3))
        lines.push(`   ${line}`);
    }
  }
  if (order.notes) {
    lines.push("-".repeat(width));
    pushLabeled("Notas", order.notes);
  }
  lines.push("=".repeat(width));
  return toAsciiText(lines.join("\n"));
}

const KITCHEN_TICKET_COPIES = 1;
const KITCHEN_TICKET_ADDENDUM_COPIES = 1;

export async function printKitchenTicket(order: Order): Promise<void> {
  const text = renderKitchenTicket(order);
  savePrintJob(order.id, "kitchen_ticket", text);
  await printText(order.id, "kitchen_ticket", text, KITCHEN_PRINTER_QUEUE, KITCHEN_TICKET_COPIES);
}

/**
 * A short "addition" ticket for new items on an order the queue worker is
 * (re)printing - lists only the newly added items, since the kitchen already
 * has the original items cooking/plated. Only reached via the queue now
 * (order bounced to PENDING) rather than the common case for an edit - see
 * orderService.editOrderItems, which prints its own combined ticket
 * synchronously whenever the order is already ACTIVE and only falls back to
 * this queue path otherwise. Retry safety on printer failure comes from
 * order_items.printed_at / the order bouncing back through PENDING, not from
 * a saved copy of *this* rendering - see printKitchenTicketAddendum below
 * for what does get saved.
 */
export function renderKitchenTicketAddendum(
  order: Order,
  newItems: OrderItem[],
): string {
  const width = TICKET_TEXT_WIDTH;
  const lines: string[] = [];
  const pushLabeled = (label: string, value: string) =>
    lines.push(...wordWrap(`${label}: ${value}`, width));

  lines.push(centerText("DINAPOLI PIZZA", width));
  lines.push(centerText("ADICION A COMANDA", width));
  lines.push(`Orden #${order.id}`);
  lines.push(boldText(describeOrderType(order.orderType)));
  if (order.tableNumber) lines.push(boldText(`Mesa: ${order.tableNumber}`));
  if (order.customerName) pushLabeled("Cliente", order.customerName);
  lines.push("-".repeat(width));
  for (const item of groupItemsForTicket(newItems)) {
    const [firstLine, ...restLines] = describeItemTicketLines(item, width - 3);
    lines.push(`${item.quantity}x ${firstLine}`);
    for (const line of restLines) lines.push(`   ${line}`);
    if (item.notes) {
      for (const line of wordWrap(`nota: ${item.notes}`, width - 3))
        lines.push(`   ${line}`);
    }
  }
  lines.push("=".repeat(width));
  return toAsciiText(lines.join("\n"));
}

export async function printKitchenTicketAddendum(
  order: Order,
  newItems: OrderItem[],
): Promise<void> {
  const text = renderKitchenTicketAddendum(order, newItems);
  await writeToDevice(buildTextPayload(text, KITCHEN_TICKET_ADDENDUM_COPIES), KITCHEN_PRINTER_QUEUE);
  console.log(
    `[printer:thermal-80mm] printed kitchen ticket addendum for order ${order.id} (${KITCHEN_TICKET_ADDENDUM_COPIES}x)`,
  );
  // The kitchen only ever sees the addendum above (it already has the
  // original items cooking/plated) - but the order's saved 'kitchen_ticket'
  // snapshot still needs to grow to match, since that saved copy (not this
  // addendum) is what a later reprint or a delivery's counter-printer copy
  // (see reprintJob/printDeliveryComandaCopy below) sends out - both should
  // always show every item on the order, past and new, not just whatever was
  // on it the moment it was first printed.
  savePrintJob(order.id, "kitchen_ticket", renderKitchenTicket(order));
}

/**
 * Which menu category an item belongs to, for grouping a ticket's item list
 * under category headers - "Pizzas" for a pizza (not a real `categories`
 * row, they're modeled separately from products), the resolved Spanish
 * category name otherwise.
 */
function categoryNameForItem(item: OrderItem): string {
  if (item.pizzaRef) return "Pizzas";
  const ref = item.menuItemRef!;
  return getCategoryName.get(ref.category)?.name ?? ref.category;
}

/**
 * Same idea as describeItemTicketLines, but omits the leading category name -
 * for use under a category header that's already been printed once above
 * several items, instead of repeating it on every line (see
 * pushCategorizedItems below).
 */
function describeItemTicketLinesNoCategory(item: OrderItem, width: number): string[] {
  if (item.pizzaRef) return describeItemTicketLines(item, width);
  const ref = item.menuItemRef!;
  const productName = getProductName.get(ref.category, ref.product)?.name ?? ref.product;
  const bits = [productName];
  if (ref.size) bits.push(`(${getProductSizeName.get(ref.product, ref.size)?.name ?? ref.size})`);
  if (ref.drinkFlavor) bits.push(`- ${getDrinkFlavorName.get(ref.drinkFlavor)?.name ?? ref.drinkFlavor}`);
  if (ref.pizzaFlavor) bits.push(`- sabor: ${getPizzaFlavorName.get(ref.pizzaFlavor)?.name ?? ref.pizzaFlavor}`);
  return wordWrap(bits.join(" "), width);
}

/**
 * Prints one ticket section: a bold category header line above that
 * category's items, repeated per category present - instead of one flat
 * list with the category folded into every line. `items` is grouped
 * (groupItemsForTicket) first so repeat additions still combine into one
 * "Nx ..." line the same as the main ticket does.
 */
function pushCategorizedItems(lines: string[], items: OrderItem[], width: number): void {
  const byCategory = new Map<string, OrderItem[]>();
  for (const item of groupItemsForTicket(items)) {
    const category = categoryNameForItem(item);
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(item);
    else byCategory.set(category, [item]);
  }
  for (const [category, categoryItems] of byCategory) {
    lines.push(boldText(category.toUpperCase()));
    for (const item of categoryItems) {
      const [firstLine, ...restLines] = describeItemTicketLinesNoCategory(item, width - 3);
      lines.push(`${item.quantity}x ${firstLine}`);
      for (const line of restLines) lines.push(`   ${line}`);
      if (item.notes) {
        for (const line of wordWrap(`nota: ${item.notes}`, width - 3)) lines.push(`   ${line}`);
      }
    }
  }
}

/**
 * One ticket for an order edit (see orderService.editOrderItems) - added
 * items, removed items, or both at once, each its own clearly-labeled
 * section (a mixed edit gets ONE physical slip, not two). Whichever removed
 * items had already printed get a "NO PREPARAR" section; an item removed
 * before its ticket ever went out isn't included here at all - deleting the
 * row is enough there, since the kitchen never saw it in the first place.
 */
export function renderKitchenTicketEdit(
  order: Order,
  addedItems: OrderItem[],
  removedItems: OrderItem[],
): string {
  const width = TICKET_TEXT_WIDTH;
  const lines: string[] = [];
  const pushLabeled = (label: string, value: string) =>
    lines.push(...wordWrap(`${label}: ${value}`, width));

  lines.push(centerText("DINAPOLI PIZZA", width));
  lines.push(centerText("EDICION DE COMANDA", width));
  lines.push(`Orden #${order.id}`);
  lines.push(boldText(describeOrderType(order.orderType)));
  if (order.tableNumber) lines.push(boldText(`Mesa: ${order.tableNumber}`));
  if (order.customerName) pushLabeled("Cliente", order.customerName);

  if (addedItems.length > 0) {
    lines.push("-".repeat(width));
    lines.push(centerText("AGREGADOS", width));
    pushCategorizedItems(lines, addedItems, width);
  }

  if (removedItems.length > 0) {
    lines.push("-".repeat(width));
    lines.push(centerText(removedItems.length > 1 ? "ELIMINADOS - NO PREPARAR" : "ELIMINADO - NO PREPARAR", width));
    pushCategorizedItems(lines, removedItems, width);
  }

  lines.push("=".repeat(width));
  return toAsciiText(lines.join("\n"));
}

export async function printKitchenTicketEdit(
  order: Order,
  addedItems: OrderItem[],
  removedItems: OrderItem[],
): Promise<void> {
  const text = renderKitchenTicketEdit(order, addedItems, removedItems);
  await writeToDevice(buildTextPayload(text, KITCHEN_TICKET_ADDENDUM_COPIES), KITCHEN_PRINTER_QUEUE);
  console.log(
    `[printer:thermal-80mm] printed kitchen ticket edit for order ${order.id} (+${addedItems.length}/-${removedItems.length})`,
  );
  // Same reasoning as printKitchenTicketAddendum's trailing save: the saved
  // 'kitchen_ticket' snapshot must reflect the edit, since a later reprint or
  // delivery counter-printer copy sends that saved copy, not this ticket.
  savePrintJob(order.id, "kitchen_ticket", renderKitchenTicket(order));
}

// ---------------------------------------------------------------------------
// HTML -> rasterized image printing (bill)
// ---------------------------------------------------------------------------

// Every Chrome DevTools Protocol call gets this deadline. Puppeteer's default
// is 180s, which is long enough that a wedged render looks like a hang rather
// than an error - the cashier waits three minutes and then gets a 500. A bill
// that hasn't rasterized in 30s is not going to.
const PROTOCOL_TIMEOUT_MS = 30_000;
// Hard ceiling on one whole render (launch + setContent + decode + screenshot),
// independent of the per-call protocol timeout above: a page can stop
// responding without any single protocol call outliving its own deadline, and
// that is exactly what was observed wedging a settlement indefinitely.
const RENDER_TIMEOUT_MS = 45_000;

let browserPromise: Promise<Browser> | null = null;

/**
 * The shared headless Chromium, launched on first use.
 *
 * The promise is dropped on failure and on disconnect, so the next caller
 * launches a fresh browser instead of re-awaiting a rejected promise or
 * handing back a dead one forever. Without that, a single failed launch (or a
 * browser killed by the OS) meant no bill printed again until the whole
 * service was restarted - and since completeOrder swallows print failures,
 * nobody would notice until someone went looking for receipts.
 */
function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const pending = puppeteer
      .launch({
        headless: true,
        args: ["--no-sandbox"],
        protocolTimeout: PROTOCOL_TIMEOUT_MS,
      })
      .then((browser) => {
        browser.on("disconnected", () => {
          if (browserPromise === pending) browserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        if (browserPromise === pending) browserPromise = null;
        throw err;
      });
    browserPromise = pending;
  }
  return browserPromise;
}

/**
 * Bill rasterization runs one at a time.
 *
 * Each render opens its own Chromium page, and nothing used to bound how many
 * were open at once - completeOrder is called once per settlement, so a rush of
 * cashiers closing tables together opened a page each. Measured on this
 * hardware: fine to 4 concurrent, ~6s each at 8, and at 16 only 2 of 16
 * finished at all (the rest timed out after ~3 minutes); at 260 the pages never
 * closed and the browser leaked ~170 processes and 10GB. Serializing costs
 * roughly half a second per bill and removes the entire failure mode - a
 * thermal printer can't lay them down any faster than that anyway.
 */
let renderChain: Promise<unknown> = Promise.resolve();
function withRenderLock<T>(task: () => Promise<T>): Promise<T> {
  const result = renderChain.then(task, task);
  // The chain must not stay rejected, or every later render inherits the failure.
  renderChain = result.catch(() => undefined);
  return result;
}

function withTimeout<T>(task: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    task,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer)) as Promise<T>;
}

let logoDataUri: string | null = null;
function getLogoDataUri(): string {
  if (!logoDataUri) {
    logoDataUri = `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString("base64")}`;
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

/** Serialized and time-boxed (see withRenderLock/RENDER_TIMEOUT_MS) so one bad page can never hang the settlement that asked for it. */
function renderHtmlToPng(html: string): Promise<Buffer> {
  return withRenderLock(() => withTimeout(renderHtmlToPngUnguarded(html), RENDER_TIMEOUT_MS, "bill rasterization"));
}

async function renderHtmlToPngUnguarded(html: string): Promise<Buffer> {
  const resolvedHtml = html.split(LOGO_PLACEHOLDER).join(getLogoDataUri());
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({
      width: RECEIPT_WIDTH_PX,
      height: MAX_RECEIPT_HEIGHT_PX,
      deviceScaleFactor: 1,
    });
    await page.setContent(resolvedHtml, { waitUntil: "load" });
    // `waitUntil: 'load'` alone isn't a strong enough guarantee that the
    // embedded base64 logo has finished decoding - without this, the layout
    // shift from a late decode can hit Chromium's tile-stitching bug and
    // produce a screenshot with repeated content.
    await page.evaluate(() => {
      const doc = (globalThis as unknown as BrowserGlobal).document;
      return Promise.all(Array.from(doc.images).map((img) => img.decode()));
    });
    const contentHeight = await page.evaluate(
      () => (globalThis as unknown as BrowserGlobal).document.body.scrollHeight,
    );
    return Buffer.from(
      await page.screenshot({
        type: "png",
        clip: {
          x: 0,
          y: 0,
          width: RECEIPT_WIDTH_PX,
          height: Math.min(contentHeight, MAX_RECEIPT_HEIGHT_PX),
        },
      }),
    );
  } finally {
    // Closing must never throw or hang here: this runs on the failure path too,
    // where the page is already misbehaving, and letting it reject would mask
    // the real error (or wedge the renderer that a leaked page belongs to).
    await withTimeout(page.close(), 5_000, "page close").catch((err) => {
      console.error("[printer:thermal-80mm] failed to close the render page:", (err as Error).message);
    });
  }
}

/** Floyd-Steinberg dither to 1-bit-per-pixel, MSB-first, packed rows (white background composite). */
function ditherToBits(png: PNG): {
  height: number;
  bytesPerRow: number;
  bits: Uint8Array;
} {
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
    const band = Buffer.from(
      bits.buffer,
      bits.byteOffset + y0 * bytesPerRow,
      bandHeight * bytesPerRow,
    );
    chunks.push(header, Buffer.from(band));
  }

  chunks.push(CMD_FEED_4, CMD_CUT_PARTIAL);
  return Buffer.concat(chunks);
}

async function printHtmlAsImage(
  orderId: number,
  kind: PrintJobKind,
  html: string,
  queue: string,
): Promise<void> {
  const pngBuffer = await renderHtmlToPng(html);
  const png = PNG.sync.read(pngBuffer);
  if (PRINTER_EMULATION_DIR) {
    // The raster payload alone is only readable as a dithered bitmap - keep the
    // rendered PNG alongside it so an emulated bill can actually be looked at.
    fs.mkdirSync(PRINTER_EMULATION_DIR, { recursive: true });
    fs.writeFileSync(path.join(PRINTER_EMULATION_DIR, `order-${orderId}-${kind}.png`), pngBuffer);
    fs.writeFileSync(path.join(PRINTER_EMULATION_DIR, `order-${orderId}-${kind}.html`), html);
  }
  await writeToDevice(buildRasterPayload(png), queue);
  console.log(
    `[printer:thermal-80mm] printed '${kind}' for order ${orderId} (raster ${png.width}x${png.height})`,
  );
}

export async function printBillHtml(
  orderId: number,
  html: string,
): Promise<void> {
  savePrintJob(orderId, "bill", html);
  await printHtmlAsImage(orderId, "bill", html, COUNTER_PRINTER_QUEUE);
}

/** True once a bill has been generated for this order (so a correction knows whether there's a saved copy to refresh). */
export function hasSavedBill(orderId: number): boolean {
  return getPrintJob.get(orderId, "bill") != null;
}

const deletePrintJobStmt = db.prepare<[number, PrintJobKind]>(
  "DELETE FROM print_jobs WHERE order_id = ? AND kind = ?",
);

/** Clears a saved job so it stops being reprintable and hasSavedBill reports false - used to invalidate a dine-in bill preview once the order it describes has changed (see orderService.editOrderItems). */
export function deletePrintJob(orderId: number, kind: PrintJobKind): void {
  deletePrintJobStmt.run(orderId, kind);
}

/**
 * Replaces an order's saved bill without printing anything. Used after a
 * payment split is corrected on an already-completed order
 * (orderService.updateOrderPayments): the saved copy is what a later reprint
 * sends out, so leaving it alone meant a reprinted bill still showed the
 * payment methods from before the correction.
 */
export function updateSavedBill(orderId: number, html: string): void {
  savePrintJob(orderId, "bill", html);
}

// ---------------------------------------------------------------------------
// Reprinting
// ---------------------------------------------------------------------------

export async function reprintJob(
  orderId: number,
  kind: PrintJobKind,
): Promise<void> {
  const row = getPrintJob.get(orderId, kind);
  if (!row) {
    throw new NotFoundError(
      `no hay un '${kind}' guardado para reimprimir de la orden ${orderId}`,
    );
  }
  if (kind === "kitchen_ticket") {
    // Unlike the original print (kitchen + cashier copy, see
    // KITCHEN_TICKET_COPIES), a reprint from order-history/order-detail is a
    // one-off re-issue - only one copy. Goes to counter_printer, not back to
    // the kitchen line - kitchen_printer is reserved for the original ticket
    // and live addition notifications only (see printKitchenTicketAddendum);
    // any reprint is a cashier/register action, same as the bill below.
    await printText(orderId, kind, row.content, COUNTER_PRINTER_QUEUE, 1);
  } else {
    await printHtmlAsImage(orderId, kind, row.content, COUNTER_PRINTER_QUEUE);
  }
}

/**
 * Splices a payment section into an already-rendered kitchen ticket, right
 * before its closing "====" separator - for the delivery counter copy
 * printed at order close (see printDeliveryComandaCopy), once payment is
 * known: the order's total and, broken out per method, how much was
 * collected via each (gross minus that split's own discount - the same
 * "what was actually collected" figure the bill's own payment lines show,
 * see billingService). Set off with its own "----" divider, same as the
 * order-notes section above it, so it reads as a distinct block rather than
 * more ticket lines. A plain-text splice on the printed copy rather than a
 * renderKitchenTicket param: the saved print_jobs row must stay
 * payment-agnostic (the kitchen's copy prints well before any payment
 * exists), so this only touches the text actually sent to the printer here,
 * never what's persisted.
 */
function appendPaymentSummary(content: string, payments: Order["payments"]): string {
  if (payments.length === 0) return content;

  const collected = payments.map((p) => p.grossAmount - p.discount);
  const total = collected.reduce((sum, amount) => sum + amount, 0);

  const width = TICKET_TEXT_WIDTH;
  const section = [
    "-".repeat(width),
    `Total: ${formatMoney(total)}`,
    ...payments.map((p, i) => `${describePaymentMethod(p.method)}: ${formatMoney(collected[i])}`),
  ].flatMap((line) => wordWrap(line, width));

  const lines = content.split("\n");
  const closingIndex = lines.length - 1; // the "====" separator renderKitchenTicket always ends on
  lines.splice(closingIndex, 0, ...section);
  return lines.join("\n");
}

/**
 * Delivery orders leave the building with the driver, unlike dine-in/
 * takeaway where the kitchen ticket already printed at intake stays with the
 * kitchen - a copy needs to go out with the order itself. Called from
 * completeOrder alongside the bill, and printed on counter_printer (not
 * kitchen_printer like the original comanda) since this copy travels with
 * the order/bill, not back to the kitchen line. `payments` is already known
 * by the time this runs (completeOrder inserts them before printing), so the
 * driver's copy can show how the order was actually paid.
 */
export async function printDeliveryComandaCopy(orderId: number, payments: Order["payments"]): Promise<void> {
  const row = getPrintJob.get(orderId, "kitchen_ticket");
  if (!row) {
    throw new NotFoundError(
      `no hay un 'kitchen_ticket' guardado para la orden ${orderId}`,
    );
  }
  await printText(orderId, "kitchen_ticket", appendPaymentSummary(row.content, payments), COUNTER_PRINTER_QUEUE, 1);
}
