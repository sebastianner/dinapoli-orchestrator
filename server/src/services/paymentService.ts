import { ValidationError } from '../utils/errors.js';
import type { Order, PaymentMethod } from '../types/dinapoly-types.js';

export interface PaymentSplit {
  method: PaymentMethod;
  /** Integer COP. Total charged via this method, tip included. */
  amount: number;
  /** Integer COP. The slice of `amount` that's tip rather than sales. */
  tipAmount: number;
}

export interface Payment {
  orderId: number;
  /** One entry per method used. A plain single-method payment is just one entry. */
  payments: PaymentSplit[];
  amountCOP: number;
  processedAt: string;
}

/**
 * Processes the total price of an order in COP, including tip and delivery fee
 * (both are excluded from `order.total`, but they're still cash the customer
 * actually hands over, so they belong in the amount collected). `payments` may
 * split that amount across more than one method (e.g. part cash, part card) -
 * the caller (orderService.completeOrder) has already validated it sums to
 * `order.total + order.tip + order.deliveryFee`. This is a stub for now
 * (every method is "processed" the same way); swap in a real payment gateway
 * integration here later without touching call sites.
 */
export function processPayment(order: Order, payments: PaymentSplit[]): Payment {
  if (!Number.isInteger(order.total) || order.total <= 0) {
    throw new ValidationError('order total must be a positive integer amount in COP');
  }

  const amountCOP = order.total + order.tip + order.deliveryFee;
  const breakdown = payments
    .map((p) => `${p.amount} COP via ${p.method}${p.tipAmount > 0 ? ` (incl. ${p.tipAmount} tip)` : ''}`)
    .join(' + ');
  console.log(`[payment] processed ${amountCOP} COP (${breakdown}) for order ${order.id}`);

  return {
    orderId: order.id,
    payments,
    amountCOP,
    processedAt: new Date().toISOString(),
  };
}
