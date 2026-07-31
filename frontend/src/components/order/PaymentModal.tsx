import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/common/Modal";
import { formatCOP } from "@/lib/format";
import { completeOrder } from "@/lib/api";
import { randomUUID } from "@/lib/uuid";
import { useOrderStore } from "@/store/useOrderStore";
import type { Order, PaymentMethod } from "@/types/api";

interface PaymentSplitRow {
  clientId: string;
  method: PaymentMethod;
  /**
   * Net amount actually collected via this method (tip/delivery fee in, this
   * split's discount already out) - what the cashier hands back change
   * against. Deliberately NOT named the same as the API's `grossAmount`
   * (= netAmount + discount, added back in handleSubmit) so the two can't be
   * confused with each other while editing.
   */
  netAmount: string;
  tipAmount: string;
  deliveryFee: string;
  discount: string;
}

const methodLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
};

interface PaymentModalProps {
  open: boolean;
  order: Order;
  onClose: () => void;
  onSuccess: (completedOrder: Order) => void;
}

export function PaymentModal({
  open,
  order,
  onClose,
  onSuccess,
}: PaymentModalProps) {
  const isDeliveryOrder = order.orderType === "delivery";
  // Built dynamically (delivery adds a column) so it can't be a static Tailwind
  // arbitrary-value class anyway - grid columns as fr shares of the modal's own
  // width guarantee the row can never be wider than its container, unlike the
  // old fixed per-input widths which overflowed the modal on delivery orders
  // (and worse once a second split's trash icon added yet another column).
  const paymentRowColumns = isDeliveryOrder
    ? "1.3fr 1fr 0.9fr 0.9fr 0.9fr auto"
    : "1.3fr 1fr 0.9fr 0.9fr auto";
  // Tip/delivery fee/discount are never set on `order` before completion (see
  // useOrderStore) - the draft values from the Order Overview panel are the
  // starting point here, and this is the one and only place they get sent to
  // the server, as part of `payments` in handleSubmit.
  const pendingTip = useOrderStore((s) => s.pendingTip);
  const pendingDeliveryFee = useOrderStore((s) => s.pendingDeliveryFee);
  const pendingDiscount = useOrderStore((s) => s.pendingDiscount);

  const [splits, setSplits] = useState<PaymentSplitRow[]>(() => [
    {
      clientId: randomUUID(),
      method: "cash",
      netAmount: String(
        order.total + pendingTip + pendingDeliveryFee - pendingDiscount,
      ),
      tipAmount: String(pendingTip),
      deliveryFee: String(pendingDeliveryFee),
      discount: String(pendingDiscount),
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `netAmount` per split is what's actually collected (what the cashier
  // hands back change against); the GROSS amount (netAmount + discount) is
  // what's sent to and stored by the API, so the pre-discount price is
  // never lost - see OrderPayment.grossAmount.
  const sumTip = splits.reduce((sum, s) => sum + (Number(s.tipAmount) || 0), 0);
  const sumDeliveryFee = splits.reduce(
    (sum, s) => sum + (Number(s.deliveryFee) || 0),
    0,
  );
  const sumDiscount = splits.reduce(
    (sum, s) => sum + (Number(s.discount) || 0),
    0,
  );
  const grossOwed = order.total + sumTip + sumDeliveryFee;
  const totalOwed = grossOwed - sumDiscount;
  const sumNetAmount = splits.reduce((sum, s) => sum + (Number(s.netAmount) || 0), 0);
  const remaining = totalOwed - sumNetAmount;
  const isValid =
    sumNetAmount === totalOwed && splits.every((s) => Number(s.netAmount) > 0);

  const reset = () => {
    setSplits([
      {
        clientId: randomUUID(),
        method: "cash",
        netAmount: String(
          order.total + pendingTip + pendingDeliveryFee - pendingDiscount,
        ),
        tipAmount: String(pendingTip),
        deliveryFee: String(pendingDeliveryFee),
        discount: String(pendingDiscount),
      },
    ]);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const updateSplit = (clientId: string, patch: Partial<PaymentSplitRow>) => {
    setSplits((prev) =>
      prev.map((s) => (s.clientId === clientId ? { ...s, ...patch } : s)),
    );
  };

  /** With a single payment method, grow/shrink its net Monto by the same amount as the tip/delivery-fee change instead of making the user do that math. */
  const updateTip = (clientId: string, tipAmount: string) => {
    setSplits((prev) =>
      prev.map((s) => {
        if (s.clientId !== clientId) return s;
        if (prev.length !== 1) return { ...s, tipAmount };
        const newTotal =
          order.total +
          (Number(tipAmount) || 0) +
          (Number(s.deliveryFee) || 0) -
          (Number(s.discount) || 0);
        return { ...s, tipAmount, netAmount: String(newTotal) };
      }),
    );
  };

  const updateDeliveryFee = (clientId: string, deliveryFee: string) => {
    setSplits((prev) =>
      prev.map((s) => {
        if (s.clientId !== clientId) return s;
        if (prev.length !== 1) return { ...s, deliveryFee };
        const newTotal =
          order.total +
          (Number(s.tipAmount) || 0) +
          (Number(deliveryFee) || 0) -
          (Number(s.discount) || 0);
        return { ...s, deliveryFee, netAmount: String(newTotal) };
      }),
    );
  };

  /** Unlike tip/delivery fee, a bigger discount shrinks the net Monto - it's less cash collected, not more. */
  const updateDiscount = (clientId: string, discount: string) => {
    setSplits((prev) =>
      prev.map((s) => {
        if (s.clientId !== clientId) return s;
        if (prev.length !== 1) return { ...s, discount };
        const newTotal =
          order.total +
          (Number(s.tipAmount) || 0) +
          (Number(s.deliveryFee) || 0) -
          (Number(discount) || 0);
        return { ...s, discount, netAmount: String(newTotal) };
      }),
    );
  };

  const addSplit = () => {
    setSplits((prev) => [
      ...prev,
      {
        clientId: randomUUID(),
        method: "cash",
        netAmount: String(Math.max(remaining, 0)),
        tipAmount: "0",
        deliveryFee: "0",
        discount: "0",
      },
    ]);
  };

  const removeSplit = (clientId: string) => {
    setSplits((prev) => prev.filter((s) => s.clientId !== clientId));
  };

  const handleSubmit = async () => {
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      const completedOrder = await completeOrder(
        order.id,
        splits.map((s) => {
          const discount = Number(s.discount) || 0;
          // The API always stores the GROSS amount (net collected + its discount
          // slice), so the pre-discount price stays on record - see OrderPayment.grossAmount.
          return {
            method: s.method,
            grossAmount: (Number(s.netAmount) || 0) + discount,
            tipAmount: Number(s.tipAmount) || 0,
            deliveryFee: Number(s.deliveryFee) || 0,
            discount,
          };
        }),
      );
      reset();
      onSuccess(completedOrder);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo completar la orden",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Cobrar orden"
      className="max-w-2xl"
    >
      <div className="mb-4 flex items-center justify-between rounded-lg bg-brand-500/10 px-4 py-3">
        <span className="text-sm font-medium text-text-secondary">
          Total a pagar
        </span>
        {sumDiscount > 0 ? (
          <span className="flex items-baseline gap-1.5">
            <span className="text-sm text-text-secondary line-through">
              {formatCOP(grossOwed)}
            </span>
            <span className="text-xl font-bold text-success">
              {formatCOP(totalOwed)}
            </span>
          </span>
        ) : (
          <span className="text-xl font-bold text-brand-700">
            {formatCOP(totalOwed)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div
          className="grid items-center gap-2 text-xs font-medium text-text-secondary"
          style={{ gridTemplateColumns: paymentRowColumns }}
        >
          <span>Método de pago</span>
          <span>Monto a cobrar</span>
          <span>Descuento</span>
          <span>Propina</span>
          {isDeliveryOrder && <span>Domicilio</span>}
          <span />
        </div>

        {splits.map((split) => (
          <div
            key={split.clientId}
            className="grid items-center gap-2"
            style={{ gridTemplateColumns: paymentRowColumns }}
          >
            <select
              value={split.method}
              onChange={(e) =>
                updateSplit(split.clientId, {
                  method: e.target.value as PaymentMethod,
                })
              }
              className="w-full min-w-0 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            >
              {(Object.keys(methodLabels) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {methodLabels[m]}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              value={split.netAmount}
              onChange={(e) =>
                updateSplit(split.clientId, { netAmount: e.target.value })
              }
              placeholder="Monto"
              className="w-full min-w-0 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
            <input
              type="number"
              min={0}
              value={split.discount}
              onChange={(e) => updateDiscount(split.clientId, e.target.value)}
              placeholder="Descuento"
              className="w-full min-w-0 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
            <input
              type="number"
              min={0}
              value={split.tipAmount}
              onChange={(e) => updateTip(split.clientId, e.target.value)}
              placeholder="Propina"
              className="w-full min-w-0 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
            {isDeliveryOrder && (
              <input
                type="number"
                min={0}
                value={split.deliveryFee}
                onChange={(e) =>
                  updateDeliveryFee(split.clientId, e.target.value)
                }
                placeholder="Domicilio"
                className="w-full min-w-0 rounded-lg border border-border bg-surface px-2 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
              />
            )}
            {splits.length > 1 ? (
              <button
                type="button"
                onClick={() => removeSplit(split.clientId)}
                aria-label="Quitar método de pago"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-secondary hover:bg-danger-bg hover:text-danger"
              >
                <Trash2 size={16} />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={addSplit}
          className="self-start text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          + Dividir en otro método de pago
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-1 text-sm">
        <div className="flex justify-between text-text-secondary">
          <span>Asignado</span>
          <span
            className={
              remaining !== 0
                ? "font-medium text-danger"
                : "font-medium text-success"
            }
          >
            {formatCOP(sumNetAmount)}
          </span>
        </div>
        {remaining !== 0 && (
          <div className="flex justify-between text-text-secondary">
            <span>{remaining > 0 ? "Falta" : "Sobra"}</span>
            <span className="font-medium text-danger">
              {formatCOP(Math.abs(remaining))}
            </span>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isValid || submitting}
        className="mt-4 w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-50"
      >
        {submitting ? "Procesando..." : "Confirmar cobro"}
      </button>
    </Modal>
  );
}
