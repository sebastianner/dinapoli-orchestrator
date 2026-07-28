import WebSocket from "ws";
import type { Employee, OrderRequest } from "../src/types/dinapoly-types.js";

const url = process.env.WS_URL ?? "ws://localhost:3001/ws/orders";
const httpBase = url.replace(/^ws/, "http").replace(/\/ws\/orders$/, "");

// Orders now require a real employeeId (see orderService.validateOrderRequest)
// - fetch one rather than hardcoding an id, so this script keeps working
// however the DB happens to be seeded. Employee creation is admin-gated, so
// this deliberately doesn't try to create one itself if none exist.
const employeesRes = await fetch(`${httpBase}/api/employees/active`);
const employees = (await employeesRes.json()) as Employee[];
if (employees.length === 0) {
  console.error("No active employees found - create one first (e.g. npm run admin:create -- \"<name>\" \"<password>\").");
  process.exit(1);
}
const employeeId = employees[0].id;

const ws = new WebSocket(url);

const order: OrderRequest = {
  orderType: "dine_in",
  tableNumber: 6,
  employeeId,
  items: [
    {
      type: "pizza",
      size: "xlarge",
      flavors: [
        { flavor: "hawaiian", portion: 50 },
        { flavor: "pepperoni", portion: 25 },
        { flavor: "margherita", portion: 25 },
      ],
      quantity: 1,
    },
    {
      type: "pizza",
      size: "xlarge",
      flavors: [
        { flavor: "curramba", portion: 50 },
        { flavor: "tropical", portion: 50 },
      ],
      quantity: 1,
    },
    {
      type: "product",
      category: "drinks",
      product: "juice",
      option: "mango",
      quantity: 2,
    },
  ],
};

ws.on("open", () => {
  console.log("connected, sending order...");
  ws.send(JSON.stringify(order));
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "connected") return; // initial handshake ack, not the order result
  console.log("received:", JSON.stringify(msg));
  ws.close();
});

ws.on("error", (err) => {
  console.error("ws error:", err.message);
  process.exit(1);
});
