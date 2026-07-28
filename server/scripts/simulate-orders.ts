// Simulates a busy shift: after the WebSocket connects and the server sends its
// 'connected' handshake ack, one order from ORDERS is sent every 30 seconds until
// the array is exhausted, then the connection closes.
import WebSocket from "ws";
import type { Employee, OrderRequest } from "../src/types/dinapoly-types.js";

const url = process.env.WS_URL ?? "ws://localhost:3001/ws/orders";
const HTTP_BASE = url.replace(/^ws/, "http").replace(/\/ws\/orders$/, "");
const SEND_INTERVAL_MS = 200;

async function createCustomer(name: string, phone?: string): Promise<number> {
  const res = await fetch(`${HTTP_BASE}/api/customers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, phone }),
  });
  if (!res.ok) throw new Error(`POST /api/customers failed: ${res.status}`);
  return ((await res.json()) as { id: number }).id;
}

async function createAddress(customerId: number, streetAddress: string): Promise<number> {
  const citiesRes = await fetch(`${HTTP_BASE}/api/locations/cities`);
  const cities = (await citiesRes.json()) as { id: number }[];
  if (cities.length === 0) throw new Error("no cities seeded - run npm run db:seed first");
  const neighborhoodsRes = await fetch(`${HTTP_BASE}/api/locations/cities/${cities[0].id}/neighborhoods`);
  const neighborhoods = (await neighborhoodsRes.json()) as { id: number }[];
  if (neighborhoods.length === 0) throw new Error("no neighborhoods seeded - run npm run db:seed first");

  const res = await fetch(`${HTTP_BASE}/api/customers/${customerId}/addresses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ streetAddress, propertyType: "HOUSE", neighborhoodId: neighborhoods[0].id }),
  });
  if (!res.ok) throw new Error(`POST /api/customers/${customerId}/addresses failed: ${res.status}`);
  return ((await res.json()) as { id: number }).id;
}

// takeaway/delivery orders below now reference a real customerId/
// customerAddressId (see orderService.validateOrderRequest) instead of an
// inline {name,phone,address} - resolved once up front via the REST API
// rather than over the WS the rest of this script uses.
console.log(`Creating test customers via ${HTTP_BASE}...`);
const lauraId = await createCustomer("Laura Gómez");
const andreaId = await createCustomer("Andrea");
const carlosId = await createCustomer("Carlos Ruiz", "3011234567");
const carlosAddressId = await createAddress(carlosId, "Cra 45 #12-30");
const pedroId = await createCustomer("Pedro", "3009876543");
const pedroAddressId = await createAddress(pedroId, "Calle 80 #10-05");
console.log("Test customers ready.");

// Orders now require a real employeeId (see orderService.validateOrderRequest)
// - fetch one rather than hardcoding an id, so this script keeps working
// however the DB happens to be seeded.
const employeesRes = await fetch(`${HTTP_BASE}/api/employees/active`);
const employees = (await employeesRes.json()) as Employee[];
if (employees.length === 0) {
  throw new Error('No active employees found - create one first (e.g. npm run admin:create -- "<name>" "<password>").');
}
const employeeId = employees[0].id;

const ORDER_TEMPLATES: Omit<OrderRequest, "employeeId">[] = [
  {
    orderType: "dine_in",
    tableNumber: 3,
    items: [
      {
        type: "pizza",
        size: "medium",
        flavors: [
          { flavor: "margherita", portion: 50 },
          { flavor: "hawaiian", portion: 50 },
        ],
        quantity: 1,
        notes: "sin cebolla",
      },
      {
        type: "product",
        category: "drinks",
        product: "soft_drink",
        option: "coca_cola",
        quantity: 2,
      },
    ],
  },
  {
    orderType: "dine_in",
    tableNumber: 7,
    items: [
      {
        type: "pizza",
        size: "large",
        flavors: [
          { flavor: "margherita", portion: 50 },
          { flavor: "bbq", portion: 50 },
        ],
        quantity: 1,
      },
      {
        type: "product",
        category: "drinks",
        product: "juice",
        option: "lulo",
        quantity: 1,
      },
    ],
  },
  {
    orderType: "takeaway",
    customerId: lauraId,
    items: [
      {
        type: "product",
        category: "pastas",
        product: "carbonara",
        quantity: 1,
      },
      {
        type: "product",
        category: "lasagnas",
        product: "bolognese",
        quantity: 1,
      },
      {
        type: "product",
        category: "desserts",
        product: "ice_cream",
        quantity: 1,
      },
    ],
  },
  {
    orderType: "delivery",
    customerId: carlosId,
    customerAddressId: carlosAddressId,
    items: [
      {
        type: "product",
        category: "calzones",
        product: "calzone",
        size: "large",
        pizzaFlavor: "tricaccio",
        quantity: 1,
      },
      {
        type: "product",
        category: "drinks",
        product: "coca_cola_3l",
        quantity: 1,
      },
    ],
  },
  {
    orderType: "dine_in",
    tableNumber: 9,
    notes: "Cumpleaños, por favor traer vela",
    items: [
      {
        type: "product",
        category: "gratinados",
        product: "gratin",
        pizzaFlavor: "napolitana",
        quantity: 1,
      },
      {
        type: "product",
        category: "appetizers",
        product: "garlic_bread",
        quantity: 1,
      },
      {
        type: "product",
        category: "drinks",
        product: "beer",
        option: "poker",
        quantity: 3,
      },
    ],
  },
  {
    orderType: "takeaway",
    customerId: andreaId,
    items: [
      {
        type: "pizza",
        size: "xlarge",
        flavors: [
          { flavor: "bbq", portion: 25 },
          { flavor: "tropical", portion: 25 },
          { flavor: "tricaccio", portion: 25 },
          { flavor: "bella_napoli", portion: 25 },
        ],
        quantity: 1,
        notes: "extra queso",
      },
      {
        type: "product",
        category: "drinks",
        product: "milkshake",
        option: "oreo",
        quantity: 1,
      },
    ],
  },
  {
    orderType: "delivery",
    customerId: pedroId,
    customerAddressId: pedroAddressId,
    items: [
      { type: "product", category: "pastas", product: "seafood", quantity: 2 },
      {
        type: "product",
        category: "desserts",
        product: "sweet_pizza",
        quantity: 1,
      },
      {
        type: "product",
        category: "drinks",
        product: "italian_soda",
        option: "pina",
        quantity: 1,
      },
    ],
  },
  {
    orderType: "dine_in",
    tableNumber: 4,
    items: [
      {
        type: "pizza",
        size: "personal",
        flavors: [{ flavor: "napolitana", portion: 100 }],
        quantity: 3,
        notes: "bien cocidas",
      },
      {
        type: "product",
        category: "drinks",
        product: "soft_drink",
        option: "agua",
        quantity: 3,
      },
    ],
  },
];

const ORDERS: OrderRequest[] = ORDER_TEMPLATES.map((o) => ({ ...o, employeeId }));

const ws = new WebSocket(url);
let index = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function sendNext(): void {
  if (index >= ORDERS.length) {
    console.log(`\nAll ${ORDERS.length} orders sent. Closing connection.`);
    if (timer) clearInterval(timer);
    ws.close();
    return;
  }
  const order = ORDERS[index];
  console.log(
    `\n[${new Date().toISOString()}] sending order ${index + 1}/${ORDERS.length} (${order.orderType})...`,
  );
  ws.send(JSON.stringify(order));
  index++;
}

ws.on("open", () => {
  console.log("connected, waiting for handshake ack...");
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "connected") {
    console.log(`handshake acknowledged: ${msg.message}`);
    console.log(
      `starting simulation: 1 order every ${SEND_INTERVAL_MS / 1000}s`,
    );
    sendNext();
    timer = setInterval(sendNext, SEND_INTERVAL_MS);
    return;
  }

  if (msg.type === "order_created") {
    console.log(
      `  -> order #${msg.order.id} created (${msg.order.orderType}), total ${msg.order.total} COP`,
    );
    return;
  }

  // 'order_updated'/'tables_updated' are broadcast to every connected client
  // (see ws/broadcast.ts) whenever any order changes status/items or a table
  // flips free/busy - not just to whoever caused the change. Since this
  // script is itself a connected client, it gets these too (its own order
  // creations trigger them, both immediately and again as the print queue
  // moves the order PENDING -> PRINTING -> ACTIVE) - they aren't errors, just
  // informational, so log them distinctly instead of falling into the
  // 'error' branch below (which assumes every other message has a
  // `.message`, which these don't - hence the old "error: undefined").
  if (msg.type === "order_updated" || msg.type === "tables_updated") {
    console.log(`  -> broadcast: ${msg.type}${"orderId" in msg ? ` (order #${msg.orderId})` : ""}`);
    return;
  }

  console.log(`  -> error: ${msg.message}`);
});

ws.on("close", () => {
  console.log("connection closed.");
  process.exit(0);
});

ws.on("error", (err) => {
  console.error("ws error:", err.message);
  process.exit(1);
});
