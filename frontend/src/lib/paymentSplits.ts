import type { PaymentMethod, PaymentSplitRequest } from '@/types/api';

/**
 * The settlement math shared by PaymentModal (charging an order) and
 * EditPaymentsModal (correcting an already-charged one).
 *
 * It lives here rather than in either component because the server
 * (orderService.resolvePayments) enforces its own rules, and the two used to
 * disagree: the modals only ever checked that the splits added up *in total*,
 * while the server also checks each split on its own. With a single payment
 * method the two always agree; with a mixed payment they don't, and the modal
 * would enable "Confirmar cobro" for a settlement the server then rejected -
 * with the customer already standing at the till and a raw API error naming an
 * array index as the only explanation.
 *
 * Every rule the server applies is mirrored below, so the button is enabled
 * exactly when the request will be accepted.
 */

export interface PaymentSplitDraft {
  clientId: string;
  method: PaymentMethod;
  /**
   * What the cashier types: the cash actually collected via this method, with
   * tip and delivery fee included and this split's own discount already taken
   * off. Deliberately not named `grossAmount` (what the API stores, = this
   * plus the discount) so the two can't be mixed up while editing.
   */
  netAmount: string;
  tipAmount: string;
  deliveryFee: string;
  discount: string;
}

/** Blank string, '-', and 'abc' all mean "nothing typed yet" - treat them as 0 rather than NaN. */
function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface SplitAmounts {
  netAmount: number;
  tipAmount: number;
  deliveryFee: number;
  discount: number;
  /** What the API records for this split: everything charged to this method before its discount. */
  grossAmount: number;
}

export function amountsOf(split: PaymentSplitDraft): SplitAmounts {
  const netAmount = num(split.netAmount);
  const discount = num(split.discount);
  return {
    netAmount,
    tipAmount: num(split.tipAmount),
    deliveryFee: num(split.deliveryFee),
    discount,
    grossAmount: netAmount + discount,
  };
}

export interface SettlementTotals {
  /** Order total + every tip + every delivery fee, before discounts - what the API's grossAmount must add up to. */
  grossOwed: number;
  /** What the customer actually hands over. */
  totalOwed: number;
  assigned: number;
  /** Positive = still to collect, negative = over-assigned. */
  remaining: number;
  tips: number;
  deliveryFees: number;
  discounts: number;
}

export function settlementTotals(orderTotal: number, splits: PaymentSplitDraft[]): SettlementTotals {
  const amounts = splits.map(amountsOf);
  const tips = amounts.reduce((sum, a) => sum + a.tipAmount, 0);
  const deliveryFees = amounts.reduce((sum, a) => sum + a.deliveryFee, 0);
  const discounts = amounts.reduce((sum, a) => sum + a.discount, 0);
  const assigned = amounts.reduce((sum, a) => sum + a.netAmount, 0);
  const grossOwed = orderTotal + tips + deliveryFees;
  const totalOwed = grossOwed - discounts;
  return { grossOwed, totalOwed, assigned, remaining: totalOwed - assigned, tips, deliveryFees, discounts };
}

/**
 * Why a split can't be sent, in the cashier's own terms - or null when it's
 * fine. Mirrors orderService.resolvePayments' per-split checks one for one.
 */
export function splitProblem(split: PaymentSplitDraft): string | null {
  const { netAmount, tipAmount, deliveryFee, discount, grossAmount } = amountsOf(split);

  for (const [label, value] of [['El monto', netAmount], ['La propina', tipAmount], ['El domicilio', deliveryFee], ['El descuento', discount]] as const) {
    if (!Number.isInteger(value)) return `${label} debe ser un número entero de pesos`;
    if (value < 0) return `${label} no puede ser negativo`;
  }
  if (netAmount <= 0) return 'El monto cobrado debe ser mayor que cero';
  if (grossAmount <= 0) return 'El monto cobrado debe ser mayor que cero';

  // The server bounds tip and delivery fee by this split's own gross charge:
  // you can't put a $5.000 tip on a card line that only carries $2.000.
  if (tipAmount > grossAmount) return 'La propina no cabe en lo cobrado por este método - muévela al otro método o súbele el monto';
  if (deliveryFee > grossAmount) return 'El domicilio no cabe en lo cobrado por este método - muévelo al otro método o súbele el monto';
  if (tipAmount + deliveryFee > grossAmount) return 'La propina y el domicilio juntos superan lo cobrado por este método';

  // ...and the discount by the products slice only - discounts apply to food,
  // not to the tip or the delivery fee.
  const products = grossAmount - tipAmount - deliveryFee;
  if (discount > products) return 'El descuento supera el valor de los productos cobrados por este método';

  return null;
}

export interface SettlementValidity {
  isValid: boolean;
  /** The single most useful thing to tell the cashier right now, or null when the settlement is ready. */
  problem: string | null;
  /** Index of the offending split, for highlighting the row. */
  problemIndex: number | null;
}

export function validateSettlement(orderTotal: number, splits: PaymentSplitDraft[], orderType?: string): SettlementValidity {
  if (splits.length === 0) return { isValid: false, problem: 'Agrega al menos un método de pago', problemIndex: null };

  for (const [index, split] of splits.entries()) {
    const problem = splitProblem(split);
    if (problem) return { isValid: false, problem, problemIndex: index };
  }

  const totals = settlementTotals(orderTotal, splits);
  if (orderType != null && orderType !== 'delivery' && totals.deliveryFees > 0) {
    return { isValid: false, problem: 'Solo las órdenes a domicilio pueden cobrar domicilio', problemIndex: null };
  }
  if (totals.remaining > 0) return { isValid: false, problem: `Falta asignar ${totals.remaining.toLocaleString('es-CO')}`, problemIndex: null };
  if (totals.remaining < 0) return { isValid: false, problem: `Sobran ${Math.abs(totals.remaining).toLocaleString('es-CO')}`, problemIndex: null };

  return { isValid: true, problem: null, problemIndex: null };
}

/** The request body the API expects: gross (net collected + this split's discount), so the pre-discount price stays on record. */
export function toPaymentRequest(splits: PaymentSplitDraft[]): PaymentSplitRequest[] {
  return splits.map((split) => {
    const { tipAmount, deliveryFee, discount, grossAmount } = amountsOf(split);
    return { method: split.method, grossAmount, tipAmount, deliveryFee, discount };
  });
}
