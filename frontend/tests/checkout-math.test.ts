/**
 * The checkout math, tested against the rule the server actually enforces.
 *
 * PaymentModal and EditPaymentsModal both let the cashier type the amount they
 * physically collect per method (`netAmount`) and derive the API's
 * `grossAmount` as `netAmount + discount`. The server
 * (orderService.resolvePayments) independently requires:
 *
 *   sum(grossAmount) === order.total + sum(tipAmount) + sum(deliveryFee)
 *   tipAmount <= grossAmount and deliveryFee <= grossAmount, per split
 *   discount <= grossAmount - tipAmount - deliveryFee, per split
 *
 * These tests exercise the real `src/lib/paymentSplits` helpers the modals use
 * and assert that anything the UI considers submittable is something the server
 * will accept - so the two sides can't drift apart without a failure here.
 */
import { suite, check, eq, summary, makeRandom, resetResults, isEntrypoint } from './harness.js';
import { settlementTotals, toPaymentRequest, validateSettlement, type PaymentSplitDraft } from '../src/lib/paymentSplits.js';

type Method = 'cash' | 'card' | 'transfer';

interface SplitSpec {
  method: Method;
  netAmount: number;
  tipAmount?: number;
  deliveryFee?: number;
  discount?: number;
}

/** The modals hold every amount as a string (they're text inputs); build drafts the same way. */
let seq = 0;
function draft(spec: SplitSpec): PaymentSplitDraft {
  return {
    clientId: `c${seq++}`,
    method: spec.method,
    netAmount: String(spec.netAmount),
    tipAmount: String(spec.tipAmount ?? 0),
    deliveryFee: String(spec.deliveryFee ?? 0),
    discount: String(spec.discount ?? 0),
  };
}
const drafts = (...specs: SplitSpec[]) => specs.map(draft);

// --- the server's acceptance rule, restated independently --------------------
// Deliberately NOT imported from the app: this is the thing the UI is being
// checked against, so it has to be written out separately or the test would
// just be comparing a function to itself.

function serverAccepts(orderTotal: number, payload: ReturnType<typeof toPaymentRequest>): { ok: true } | { ok: false; why: string } {
  if (payload.length === 0) return { ok: false, why: 'payments must be non-empty' };
  for (const [i, p] of payload.entries()) {
    if (!Number.isInteger(p.grossAmount) || p.grossAmount <= 0) return { ok: false, why: `payments[${i}].grossAmount must be a positive integer` };
    if (p.tipAmount! < 0 || p.deliveryFee! < 0 || p.discount! < 0) return { ok: false, why: `payments[${i}] has a negative component` };
    if (p.tipAmount! > p.grossAmount) return { ok: false, why: `payments[${i}].tipAmount exceeds grossAmount` };
    if (p.deliveryFee! > p.grossAmount) return { ok: false, why: `payments[${i}].deliveryFee exceeds grossAmount` };
    const net = p.grossAmount - p.tipAmount! - p.deliveryFee!;
    if (net < 0) return { ok: false, why: `payments[${i}] tip+fee exceed grossAmount` };
    if (p.discount! > net) return { ok: false, why: `payments[${i}].discount exceeds the products slice` };
  }
  const owed = orderTotal + payload.reduce((s, p) => s + p.tipAmount!, 0) + payload.reduce((s, p) => s + p.deliveryFee!, 0);
  const sum = payload.reduce((s, p) => s + p.grossAmount, 0);
  if (sum !== owed) return { ok: false, why: `grossAmount sums to ${sum}, server wants ${owed}` };
  return { ok: true };
}

export function run(standalone = true) {
  resetResults();

  suite('Single-method settlement');
  {
    const splits = drafts({ method: 'cash', netAmount: 66000 });
    check('a plain exact payment is submittable', validateSettlement(66000, splits).isValid);
    eq('it posts grossAmount = the amount collected', toPaymentRequest(splits)[0].grossAmount, 66000);
    check('the server accepts it', serverAccepts(66000, toPaymentRequest(splits)).ok);
  }

  suite('Tip raises what the customer hands over');
  {
    const splits = drafts({ method: 'card', netAmount: 76000, tipAmount: 10000 });
    check('submittable', validateSettlement(66000, splits).isValid);
    eq('"Total a pagar" shown to the cashier', settlementTotals(66000, splits).totalOwed, 76000);
    check('server accepts', serverAccepts(66000, toPaymentRequest(splits)).ok);
  }

  suite('Discount lowers what the customer hands over but not what is recorded');
  {
    const splits = drafts({ method: 'cash', netAmount: 60000, discount: 6000 });
    check('submittable', validateSettlement(66000, splits).isValid);
    eq('cashier collects the discounted figure', settlementTotals(66000, splits).totalOwed, 60000);
    eq('but the API records the full pre-discount charge', toPaymentRequest(splits)[0].grossAmount, 66000);
    check('server accepts', serverAccepts(66000, toPaymentRequest(splits)).ok);
  }

  suite('Delivery: fee + tip + discount on one card');
  {
    const splits = drafts({ method: 'card', netAmount: 88000, tipAmount: 5000, deliveryFee: 7000, discount: 10000 });
    check('submittable', validateSettlement(86000, splits, 'delivery').isValid);
    eq('collected', settlementTotals(86000, splits).totalOwed, 88000);
    eq('recorded gross', toPaymentRequest(splits)[0].grossAmount, 98000);
    check('server accepts', serverAccepts(86000, toPaymentRequest(splits)).ok);
  }

  suite('Mixed payment with the tip charged to one method only');
  {
    const splits = drafts({ method: 'cash', netAmount: 20000 }, { method: 'card', netAmount: 54000, tipAmount: 8000 });
    check('submittable', validateSettlement(66000, splits).isValid);
    eq('total collected', settlementTotals(66000, splits).assigned, 74000);
    check('server accepts', serverAccepts(66000, toPaymentRequest(splits)).ok);
    const payload = toPaymentRequest(splits);
    eq('the cash split stays pure sales', payload[0].grossAmount - payload[0].tipAmount!, 20000);
    eq('the tip is attributed to the card only', payload[1].tipAmount, 8000);
  }

  suite('The UI refuses what the server would refuse');
  {
    const short = drafts({ method: 'cash', netAmount: 65999 });
    check('1 COP short is not submittable', !validateSettlement(66000, short).isValid);
    check('and it says how much is missing', (validateSettlement(66000, short).problem ?? '').includes('Falta'));
    check('the server would refuse it too', !serverAccepts(66000, toPaymentRequest(short)).ok);

    const over = drafts({ method: 'cash', netAmount: 66001 });
    check('1 COP over is not submittable', !validateSettlement(66000, over).isValid);
    check('and it says how much is left over', (validateSettlement(66000, over).problem ?? '').includes('Sobran'));

    check('a zero-amount split is not submittable', !validateSettlement(0, drafts({ method: 'cash', netAmount: 0 })).isValid);
    check('an empty split list is not submittable', !validateSettlement(66000, []).isValid);
    check('a fractional amount is not submittable', !validateSettlement(66000, drafts({ method: 'cash', netAmount: 66000.5 })).isValid);
    check('a negative tip is not submittable', !validateSettlement(66000, drafts({ method: 'cash', netAmount: 66000, tipAmount: -1000 })).isValid);
    check('a delivery fee on a non-delivery order is not submittable',
      !validateSettlement(66000, drafts({ method: 'cash', netAmount: 73000, deliveryFee: 7000 }), 'dine_in').isValid);
  }

  // These are the cases that used to slip through: the modals checked only that
  // the splits added up in total, so a mixed payment could put more tip (or
  // delivery fee) on a split than that split actually carried, and the server
  // rejected it at the till.
  suite('Mixed payment: tip charged to the smaller split');
  {
    // "Pay 35.000 in cash, put the 10.000 tip on the card" - the card only
    // carries 5.000 of the food plus the tip.
    const splits = drafts({ method: 'cash', netAmount: 35000 }, { method: 'card', netAmount: 5000, tipAmount: 10000 });
    const verdict = validateSettlement(30000, splits);
    check('the modal refuses it', !verdict.isValid);
    check('and points at the offending split', verdict.problemIndex === 1, String(verdict.problemIndex));
    check('with an explanation a cashier can act on', (verdict.problem ?? '').includes('propina'), verdict.problem ?? '');
  }

  suite('Mixed payment: delivery fee on the smaller split');
  {
    const splits = drafts({ method: 'cash', netAmount: 30000 }, { method: 'card', netAmount: 5000, deliveryFee: 7000 });
    const verdict = validateSettlement(28000, splits, 'delivery');
    check('the modal refuses it', !verdict.isValid);
    check('and points at the offending split', verdict.problemIndex === 1, String(verdict.problemIndex));
    check('with an explanation a cashier can act on', (verdict.problem ?? '').includes('domicilio'), verdict.problem ?? '');
  }

  suite('Mixed payment: the same amounts split so they DO fit');
  {
    // The fix must not block the legitimate arrangement - move the tip onto the
    // split that can carry it and the charge goes through.
    const splits = drafts({ method: 'cash', netAmount: 5000 }, { method: 'card', netAmount: 35000, tipAmount: 10000 });
    check('submittable', validateSettlement(30000, splits).isValid);
    check('server accepts', serverAccepts(30000, toPaymentRequest(splits)).ok);
  }

  suite('Randomised cross-check: anything the UI enables, the server accepts');
  {
    const rnd = makeRandom(987654321);
    let checked = 0;
    const disagreements: string[] = [];
    for (let i = 0; i < 20000; i++) {
      const orderTotal = rnd.int(1, 400) * 500;
      const isDelivery = rnd.next() < 0.35;
      const splitCount = rnd.next() < 0.3 ? 2 : 1;

      // Realistic magnitudes: a tip is a fraction of the bill, a delivery fee is
      // a few thousand COP - not arbitrary numbers larger than the order itself.
      const tips: number[] = [];
      const fees: number[] = [];
      const discounts: number[] = [];
      for (let s = 0; s < splitCount; s++) {
        tips.push(rnd.next() < 0.4 ? Math.round((orderTotal * rnd.int(5, 15)) / 100 / 500) * 500 : 0);
        fees.push(isDelivery && s === splitCount - 1 ? rnd.int(10, 20) * 500 : 0);
        discounts.push(rnd.next() < 0.25 ? Math.round((orderTotal * rnd.int(5, 30)) / 100 / 500) * 500 : 0);
      }
      const totalDiscount = discounts.reduce((a, b) => a + b, 0);
      if (totalDiscount > orderTotal) continue;

      const owedNet = orderTotal + tips.reduce((a, b) => a + b, 0) + fees.reduce((a, b) => a + b, 0) - totalDiscount;
      if (owedNet <= 0) continue;

      const nets: number[] = [];
      let remaining = owedNet;
      for (let s = 0; s < splitCount - 1; s++) {
        const part = Math.max(1, Math.floor(remaining / 2));
        nets.push(part);
        remaining -= part;
      }
      nets.push(remaining);

      const splits = nets.map((netAmount, s) =>
        draft({ method: rnd.pick(['cash', 'card', 'transfer'] as const), netAmount, tipAmount: tips[s], deliveryFee: fees[s], discount: discounts[s] }),
      );

      if (!validateSettlement(orderTotal, splits, isDelivery ? 'delivery' : 'dine_in').isValid) continue;
      checked++;
      const verdict = serverAccepts(orderTotal, toPaymentRequest(splits));
      if (!verdict.ok && disagreements.length < 5) {
        disagreements.push(`total=${orderTotal} splits=${JSON.stringify(splits)} -> ${verdict.why}`);
      }
    }
    check(`${checked} UI-valid settlements were all accepted by the server's rule`, disagreements.length === 0,
      disagreements.join('\n      '));
    check('the randomised sweep actually exercised a meaningful number of cases', checked > 5000, `only ${checked}`);
  }

  suite('Invariants that must hold for every submitted payload');
  {
    const rnd = makeRandom(13572468);
    let violations = 0;
    for (let i = 0; i < 5000; i++) {
      const orderTotal = rnd.int(1, 200) * 1000;
      const tip = rnd.next() < 0.5 ? rnd.int(0, 20) * 1000 : 0;
      const fee = rnd.next() < 0.5 ? rnd.int(0, 10) * 1000 : 0;
      const discount = rnd.next() < 0.4 ? rnd.int(0, Math.floor(orderTotal / 1000)) * 1000 : 0;
      const splits = drafts({ method: 'cash', netAmount: orderTotal + tip + fee - discount, tipAmount: tip, deliveryFee: fee, discount });
      if (!validateSettlement(orderTotal, splits, 'delivery').isValid) continue;
      const payload = toPaymentRequest(splits);
      const gross = payload.reduce((s, p) => s + p.grossAmount, 0);
      const net = payload.reduce((s, p) => s + (p.grossAmount - p.tipAmount! - p.deliveryFee!), 0);
      const collected = payload.reduce((s, p) => s + (p.grossAmount - p.discount!), 0);
      if (gross !== orderTotal + tip + fee) violations++;
      else if (net !== orderTotal) violations++;
      else if (collected !== orderTotal + tip + fee - discount) violations++;
    }
    check('gross = subtotal + tip + fee, net = subtotal, collected = gross - discount, always', violations === 0, `${violations} violations`);
  }

  summary({ exit: standalone });
}

if (isEntrypoint(import.meta.url)) run();
