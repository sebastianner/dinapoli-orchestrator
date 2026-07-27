// Stress test: blasts a configurable number of randomly-generated orders at the
// order-intake WebSocket back to back (default 100 orders, 20ms apart) instead
// of simulate-orders.ts's realistic once-every-200ms shift pace. Builds its item
// pool from the live /api/menu and /api/employees/active responses, so it stays
// valid no matter how the seeded menu/employees change. Reports per-order ack
// latency and overall throughput at the end.
//
// Usage: npm run ws:stress -- [count]
//   WS_URL         ws endpoint (default ws://localhost:3001/ws/orders)
//   ORDER_COUNT    how many orders to send (default 100, or argv[2])
//   INTERVAL_MS    ms between sends (default 20; 0 = fire as fast as possible)
import WebSocket from "ws";
import type {
  Menu,
  OrderItemRequest,
  OrderRequest,
  OrderType,
  PizzaFlavorSelection,
  PizzaSizeId,
  ProductCategoryId,
} from "../src/types/dinapoly-types.js";

const WS_URL = process.env.WS_URL ?? "ws://localhost:3001/ws/orders";
const HTTP_BASE = WS_URL.replace(/^ws/, "http").replace(/\/ws\/orders$/, "");
const ORDER_COUNT = Number(process.env.ORDER_COUNT ?? process.argv[2] ?? 100);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 20);

const FIRST_NAMES = [
  "Laura", "Carlos", "Andrea", "Pedro", "Camila", "Diego", "Valentina", "Julian",
  "Sofia", "Mateo", "Daniela", "Santiago", "Paula", "Felipe", "Natalia",
];
const STREETS = ["Cra 45 #12-30", "Calle 80 #10-05", "Cra 15 #100-20", "Calle 26 #68-90", "Cra 7 #45-12"];
const NOTES = [undefined, undefined, undefined, "sin cebolla", "extra queso", "bien cocida", "para regalo", "sin picante"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function randPhone(): string {
  return `3${randInt(0, 9)}${randInt(0, 9)}${randInt(1000000, 9999999)}`;
}

interface Pool {
  pizzaSizes: { id: PizzaSizeId; maxFlavors: number }[];
  pizzaFlavors: string[];
  productCategories: {
    id: ProductCategoryId;
    products: { id: string; sizes: string[]; options: string[]; requiresPizzaFlavor: boolean }[];
  }[];
  employeeIds: number[];
}

async function loadPool(): Promise<Pool> {
  const menuRes = await fetch(`${HTTP_BASE}/api/menu`);
  if (!menuRes.ok) throw new Error(`GET /api/menu failed: ${menuRes.status}`);
  const menu = (await menuRes.json()) as Menu;

  const pizzaSizes = new Map<PizzaSizeId, number>();
  const pizzaFlavors = new Set<string>();
  const productCategories: Pool["productCategories"] = [];

  for (const cat of menu.menu) {
    if (cat.id === "pizzas") {
      for (const group of cat.groups) {
        for (const size of group.sizes) {
          if (size.price != null) pizzaSizes.set(size.id, size.maxFlavors);
        }
        for (const flavor of group.flavors) pizzaFlavors.add(flavor.id);
      }
    } else {
      productCategories.push({
        id: cat.id,
        products: cat.products.map((p) => ({
          id: p.id,
          sizes: (p.sizes ?? []).map((s) => s.id),
          options: (p.options ?? []).map((o) => o.id),
          requiresPizzaFlavor: p.pizzaFlavor === true,
        })),
      });
    }
  }

  let employeeIds: number[] = [];
  try {
    const empRes = await fetch(`${HTTP_BASE}/api/employees/active`);
    if (empRes.ok) employeeIds = (await empRes.json()).map((e: { id: number }) => e.id);
  } catch {
    // employees are optional on an order - fine to run without any
  }

  return {
    pizzaSizes: [...pizzaSizes.entries()].map(([id, maxFlavors]) => ({ id, maxFlavors })),
    pizzaFlavors: [...pizzaFlavors],
    productCategories,
    employeeIds,
  };
}

/** Mirrors frontend lib/pricing.ts's computeFlavorPortions: even split, remainder to the first flavor. */
function randomPortions(flavors: string[]): PizzaFlavorSelection[] {
  const n = flavors.length;
  const base = Math.floor(100 / n);
  const remainder = 100 - base * n;
  return flavors.map((flavor, i) => ({ flavor, portion: i === 0 ? base + remainder : base }));
}

function randomPizzaItem(pool: Pool): OrderItemRequest {
  const size = pick(pool.pizzaSizes);
  const flavorCount = randInt(1, size.maxFlavors);
  const shuffled = [...pool.pizzaFlavors].sort(() => Math.random() - 0.5);
  const flavors = randomPortions(shuffled.slice(0, flavorCount));
  return { type: "pizza", size: size.id, flavors, quantity: randInt(1, 3), notes: pick(NOTES) };
}

function randomProductItem(pool: Pool): OrderItemRequest {
  const category = pick(pool.productCategories);
  const product = pick(category.products);
  return {
    type: "product",
    category: category.id,
    product: product.id,
    size: product.sizes.length > 0 ? pick(product.sizes) : undefined,
    // The server requires `option` whenever the product has any configured options
    // (e.g. juice, beer, soft drinks) - it's only skippable for option-less products.
    option: product.options.length > 0 ? pick(product.options) : undefined,
    pizzaFlavor: product.requiresPizzaFlavor ? pick(pool.pizzaFlavors) : undefined,
    quantity: randInt(1, 3),
    notes: pick(NOTES),
  };
}

function randomOrder(pool: Pool): OrderRequest {
  const orderType = pick<OrderType>(["dine_in", "dine_in", "takeaway", "delivery"]); // dine_in weighted, most common in practice
  const itemCount = randInt(1, 4);
  const items = Array.from({ length: itemCount }, () => (Math.random() < 0.5 ? randomPizzaItem(pool) : randomProductItem(pool)));

  const base: OrderRequest = {
    orderType,
    items,
    employeeId: pool.employeeIds.length > 0 && Math.random() < 0.5 ? pick(pool.employeeIds) : undefined,
  };

  if (orderType === "dine_in") return { ...base, tableNumber: randInt(1, 9) };
  if (orderType === "takeaway") return { ...base, customer: { name: pick(FIRST_NAMES) } };
  return { ...base, customer: { name: pick(FIRST_NAMES), phone: randPhone(), address: pick(STREETS) } };
}

// ---------------------------------------------------------------------------

async function main() {
  console.log(`Loading menu/employees from ${HTTP_BASE}...`);
  const pool = await loadPool();
  console.log(
    `Pool ready: ${pool.pizzaSizes.length} pizza sizes, ${pool.pizzaFlavors.length} flavors, ` +
      `${pool.productCategories.reduce((n, c) => n + c.products.length, 0)} products, ${pool.employeeIds.length} active employees.`,
  );

  const orders = Array.from({ length: ORDER_COUNT }, () => randomOrder(pool));

  const ws = new WebSocket(WS_URL);
  const sendTimestamps: number[] = [];
  const latenciesMs: number[] = [];
  let sent = 0;
  let acked = 0;
  let errors = 0;
  let startedAt = 0;
  let sendingFinishedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  function finish() {
    if (timer) clearInterval(timer);
    const sendElapsedMs = sendingFinishedAt - startedAt;
    const totalElapsedMs = Date.now() - startedAt;
    const avg = latenciesMs.length > 0 ? latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length : 0;
    const max = latenciesMs.length > 0 ? Math.max(...latenciesMs) : 0;
    const min = latenciesMs.length > 0 ? Math.min(...latenciesMs) : 0;
    console.log("\n--- stress test results ---");
    console.log(`sent: ${sent}, acked: ${acked}, errors: ${errors}`);
    console.log(`send time: ${sendElapsedMs}ms (${(sent / (sendElapsedMs / 1000)).toFixed(1)} orders/sec sent)`);
    console.log(`total time incl. ack drain: ${totalElapsedMs}ms`);
    console.log(`ack latency ms - min: ${min.toFixed(0)}, avg: ${avg.toFixed(0)}, max: ${max.toFixed(0)}`);
    ws.close();
  }

  function allSent() {
    if (timer) clearInterval(timer);
    sendingFinishedAt = Date.now();
    // Give in-flight acks a couple seconds to land before printing results.
    setTimeout(finish, 3000);
  }

  function sendNext() {
    if (sent >= orders.length) {
      allSent();
      return;
    }
    ws.send(JSON.stringify(orders[sent]));
    sendTimestamps.push(Date.now());
    sent++;
    if (sent % 10 === 0 || sent === orders.length) process.stdout.write(`\rsent ${sent}/${orders.length}...`);
  }

  ws.on("open", () => console.log("connected, waiting for handshake ack..."));

  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.type === "connected") {
      console.log(`handshake acknowledged: ${msg.message}`);
      console.log(`sending ${ORDER_COUNT} orders, ${INTERVAL_MS}ms apart...`);
      startedAt = Date.now();
      if (INTERVAL_MS > 0) {
        sendNext();
        timer = setInterval(sendNext, INTERVAL_MS);
      } else {
        while (sent < orders.length) sendNext();
        allSent();
      }
      return;
    }

    if (msg.type === "order_created") {
      acked++;
      const sentAt = sendTimestamps[acked - 1];
      if (sentAt != null) latenciesMs.push(Date.now() - sentAt);
    } else {
      errors++;
      console.error(`\n  -> error: ${msg.message}`);
    }
  });

  ws.on("close", () => {
    console.log("connection closed.");
    process.exit(errors > 0 ? 1 : 0);
  });

  ws.on("error", (err) => {
    console.error("ws error:", err.message);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error("stress test failed to start:", err.message);
  process.exit(1);
});
