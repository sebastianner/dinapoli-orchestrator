// Simulates a busy shift: after the WebSocket connects and the server sends its
// 'connected' handshake ack, one order from ORDERS is sent every 30 seconds until
// the array is exhausted, then the connection closes.
import WebSocket from "ws";
import type { OrderRequest } from "../src/types/dinapoly-types.js";

const url = process.env.WS_URL ?? "ws://localhost:3000/ws/orders";
const SEND_INTERVAL_MS = 200;

const ORDERS: OrderRequest[] = [
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
    customer: { name: "Laura Gómez" },
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
    customer: {
      name: "Carlos Ruiz",
      phone: "3011234567",
      address: "Cra 45 #12-30",
    },
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
    customer: { name: "Andrea" },
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
    customer: {
      name: "Pedro",
      phone: "3009876543",
      address: "Calle 80 #10-05",
    },
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
  } else {
    console.log(`  -> error: ${msg.message}`);
  }
});

ws.on("close", () => {
  console.log("connection closed.");
  process.exit(0);
});

ws.on("error", (err) => {
  console.error("ws error:", err.message);
  process.exit(1);
});
