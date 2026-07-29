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
    products: { id: string; sizes: string[]; drinkFlavors: string[]; requiresPizzaFlavor: boolean }[];
  }[];
  employeeIds: number[];
  /** takeaway orders just need a customerId - see randomOrder. */
  takeawayCustomerIds: number[];
  /** delivery orders additionally need one of that customer's own addresses. */
  deliveryCustomers: { customerId: number; addressId: number }[];
}

async function createTestCustomer(name: string): Promise<number> {
  const res = await fetch(`${HTTP_BASE}/api/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, phone: randPhone() }),
  });
  if (!res.ok) throw new Error(`POST /api/customers failed: ${res.status}`);
  return ((await res.json()) as { id: number }).id;
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
          drinkFlavors: (p.drinkFlavors ?? []).map((f) => f.id),
          requiresPizzaFlavor: p.pizzaFlavor === true,
        })),
      });
    }
  }

  // Orders now require a real employeeId (see orderService.validateOrderRequest)
  // - fail fast if none exist rather than sending orders that'll all 400.
  const empRes = await fetch(`${HTTP_BASE}/api/employees/active`);
  const employeeIds: number[] = empRes.ok ? (await empRes.json()).map((e: { id: number }) => e.id) : [];
  if (employeeIds.length === 0) {
    throw new Error('No active employees found - create one first (e.g. npm run admin:create -- "<name>" "<password>").');
  }

  // takeaway/delivery orders now reference a real customerId (see
  // orderService.validateOrderRequest) instead of an inline {name,phone,
  // address} - create a handful of test customers/addresses up front rather
  // than one per order, same "build a reusable pool" spirit as pizzaFlavors/
  // productCategories above.
  const takeawayCustomerIds = await Promise.all(FIRST_NAMES.slice(0, 5).map((name) => createTestCustomer(name)));

  const deliveryCustomers: Pool["deliveryCustomers"] = [];
  let neighborhoodId: number | null = null;
  try {
    const citiesRes = await fetch(`${HTTP_BASE}/api/locations/cities`);
    const cities = citiesRes.ok ? ((await citiesRes.json()) as { id: number }[]) : [];
    if (cities.length > 0) {
      const nRes = await fetch(`${HTTP_BASE}/api/locations/cities/${cities[0].id}/neighborhoods`);
      const neighborhoods = nRes.ok ? ((await nRes.json()) as { id: number }[]) : [];
      neighborhoodId = neighborhoods[0]?.id ?? null;
    }
  } catch {
    // fall through with neighborhoodId still null
  }
  if (neighborhoodId != null) {
    for (const name of FIRST_NAMES.slice(5, 10)) {
      const customerId = await createTestCustomer(name);
      const addrRes = await fetch(`${HTTP_BASE}/api/customers/${customerId}/addresses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streetAddress: pick(STREETS), propertyType: "HOUSE", neighborhoodId }),
      });
      if (!addrRes.ok) throw new Error(`POST /api/customers/${customerId}/addresses failed: ${addrRes.status}`);
      const address = (await addrRes.json()) as { id: number };
      deliveryCustomers.push({ customerId, addressId: address.id });
    }
  }

  return {
    pizzaSizes: [...pizzaSizes.entries()].map(([id, maxFlavors]) => ({ id, maxFlavors })),
    pizzaFlavors: [...pizzaFlavors],
    productCategories,
    employeeIds,
    takeawayCustomerIds,
    deliveryCustomers,
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
    // The server requires `drinkFlavor` whenever the product has any configured
    // flavors (e.g. juice, beer, soft drinks) - only skippable for flavor-less products.
    drinkFlavor: product.drinkFlavors.length > 0 ? pick(product.drinkFlavors) : undefined,
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
    employeeId: pick(pool.employeeIds),
  };

  if (orderType === "dine_in") return { ...base, tableNumber: randInt(1, 9) };
  if (orderType === "takeaway") return { ...base, customerId: pick(pool.takeawayCustomerIds) };
  if (pool.deliveryCustomers.length === 0) {
    // No neighborhoods seeded (e.g. a fresh DB before db:seed ran) - fall
    // back to dine_in rather than sending an invalid delivery order.
    return { ...base, orderType: "dine_in", tableNumber: randInt(1, 9) };
  }
  const delivery = pick(pool.deliveryCustomers);
  return { ...base, customerId: delivery.customerId, customerAddressId: delivery.addressId };
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
