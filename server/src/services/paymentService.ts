import { ValidationError } from '../utils/errors.js';
import type { Order, PaymentMethod } from '../types/dinapoly-types.js';

export interface Payment {
  orderId: number;
  method: PaymentMethod;
  amountCOP: number;
  processedAt: string;
}

/**
 * Processes the total price of an order in COP. This is a stub for now (cash/card/transfer
 * are all "processed" the same way); swap in a real payment gateway integration here later
 * without touching call sites.
 */
export function processPayment(order: Order): Payment {
  if (!order.paymentMethod) {
    throw new ValidationError('paymentMethod is required to process payment');
  }
  if (!Number.isInteger(order.total) || order.total <= 0) {
    throw new ValidationError('order total must be a positive integer amount in COP');
  }

  console.log(`[payment] processed ${order.total} COP for order ${order.id} via ${order.paymentMethod}`);

  return {
    orderId: order.id,
    method: order.paymentMethod,
    amountCOP: order.total,
    processedAt: new Date().toISOString(),
  };
}
