import WebSocket from "ws";
import type { OrderRequest } from "../src/types/dinapoly-types.js";

const url = process.env.WS_URL ?? "ws://localhost:3000/ws/orders";
const ws = new WebSocket(url);

const order: OrderRequest = {
  orderType: "dine_in",
  customer: { name: "Don Chimbo", phone: "555-1234", address: "123 Main St" },
  paymentMethod: "cash",
  items: [
    {
      type: "pizza",
      size: "xlarge",
      flavors: ["hawaiian", "pepperoni", "margherita"],
      quantity: 1,
    },
    {
      type: "pizza",
      size: "xlarge",
      flavors: ["curramba", "tropical"],
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
