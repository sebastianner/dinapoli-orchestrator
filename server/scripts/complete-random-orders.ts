// Completes a random subset of currently ACTIVE orders with varied payment
// data (single vs. split methods, tips, discounts, delivery fees) - useful
// after ws:stress seeds a batch of orders that are all sitting ACTIVE, so
// order-history/closing-reports/cash-flow have something realistic to show
// instead of one flat status.
//
// Usage: npm run orders:complete-random -- [percent]
//   HTTP_BASE   base URL (default http://localhost:3001)
//   PERCENT     0-100, chance each ACTIVE order gets completed (default 65, or argv[2])
import type { Order, PaymentMethod } from "../src/types/dinapoly-types.js";

const HTTP_BASE = process.env.HTTP_BASE ?? "http://localhost:3001";
const PERCENT = Number(process.env.PERCENT ?? process.argv[2] ?? 65);

// The request body shape - NOT paymentService.PaymentSplit, which also carries
// netAmount, a field the server computes itself and never accepts from a client.
interface PaymentSplitRequest {
  method: PaymentMethod;
  grossAmount: number;
  tipAmount: number;
  deliveryFee: number;
  discount: number;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
/** Round to the nearest 100 COP, like a cashier would. */
function round100(n: number): number {
  return Math.round(n / 100) * 100;
}

const METHODS: PaymentMethod[] = ["cash", "cash", "card", "card", "transfer"]; // cash/card weighted heavier than transfer

function randomTip(subtotal: number): number {
  const roll = Math.random();
  if (roll < 0.35) return 0;
  if (roll < 0.65) return round100(subtotal * 0.1);
  if (roll < 0.85) return round100(subtotal * 0.2);
  return round100(subtotal * (randInt(5, 15) / 100));
}

function randomDeliveryFee(order: Order): number {
  if (order.orderType !== "delivery") return 0;
  return pick([3000, 4000, 5000, 6000]);
}

function randomDiscount(owed: number): number {
  if (Math.random() > 0.2) return 0;
  return round100(owed * (randInt(5, 15) / 100));
}

/**
 * Builds a payments[] whose `grossAmount` fields sum exactly to the GROSS
 * `owed` (order.total + tip + deliveryFee) - `discount` is only ever an
 * annotation on top of a split's grossAmount (actual cash collected =
 * grossAmount - discount, derived later), never subtracted before sending.
 * See OrderPayment.grossAmount in the schema.
 */
function buildPayments(owed: number, tip: number, deliveryFee: number, discount: number): PaymentSplitRequest[] {
  if (Math.random() > 0.3) {
    // Single method covers everything.
    return [{ method: pick(METHODS), grossAmount: owed, tipAmount: tip, deliveryFee, discount }];
  }

  // Split across two methods - tip/deliveryFee/discount all land on the first split,
  // matching the "one method absorbs the whole tip" pattern documented in the API.
  // That split's grossAmount must be at least as large as everything attributed to it.
  const [methodA, methodB] = [pick(METHODS), pick(METHODS)];
  const minFirst = tip + deliveryFee + discount;
  const firstShare = round100(owed * (randInt(30, 70) / 100));
  const firstAmount = Math.min(Math.max(firstShare, minFirst), owed);
  const secondAmount = owed - firstAmount;
  if (secondAmount <= 0) {
    return [{ method: methodA, grossAmount: owed, tipAmount: tip, deliveryFee, discount }];
  }
  return [
    { method: methodA, grossAmount: firstAmount, tipAmount: tip, deliveryFee, discount },
    { method: methodB, grossAmount: secondAmount, tipAmount: 0, deliveryFee: 0, discount: 0 },
  ];
}

async function main() {
  const res = await fetch(`${HTTP_BASE}/api/orders?status=ACTIVE`);
  if (!res.ok) throw new Error(`GET /api/orders?status=ACTIVE failed: ${res.status}`);
  const orders = (await res.json()) as Order[];

  const candidates = orders.filter((o) => Math.random() * 100 < PERCENT);
  console.log(`${orders.length} ACTIVE orders found, completing ${candidates.length} (~${PERCENT}%)...`);

  let completed = 0;
  let failed = 0;

  for (const order of candidates) {
    const tip = randomTip(order.total);
    const deliveryFee = randomDeliveryFee(order);
    const owed = order.total + tip + deliveryFee;
    const discount = randomDiscount(owed);
    const payments = buildPayments(owed, tip, deliveryFee, discount);

    try {
      const res = await fetch(`${HTTP_BASE}/api/orders/${order.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payments }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(`${res.status} ${(body as { error?: string }).error ?? ""}`);
      }
      completed++;
      const methods = payments.map((p) => p.method).join("+");
      console.log(
        `  order ${order.id} -> COMPLETED (${methods}, tip ${tip}, deliveryFee ${deliveryFee}, discount ${discount})`,
      );
    } catch (err) {
      failed++;
      console.error(`  order ${order.id} -> failed: ${(err as Error).message}`);
    }
  }

  console.log(`\ndone: ${completed} completed, ${failed} failed, ${orders.length - candidates.length} left ACTIVE.`);
}

main().catch((err) => {
  console.error("complete-random-orders failed:", err.message);
  process.exit(1);
});
