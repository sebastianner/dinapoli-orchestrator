import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/common/Modal";
import { formatCOP } from "@/lib/format";
import { updateOrderPayments } from "@/lib/api";
import { settlementTotals, toPaymentRequest, validateSettlement, type PaymentSplitDraft } from "@/lib/paymentSplits";
import { randomUUID } from "@/lib/uuid";
import type { Order, PaymentMethod } from "@/types/api";

type PaymentSplitRow = PaymentSplitDraft;

const methodLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
};

function splitsFromOrder(order: Order): PaymentSplitRow[] {
  return order.payments.map((p) => ({
    clientId: randomUUID(),
    method: p.method,
    netAmount: String(p.grossAmount - p.discount),
    tipAmount: String(p.tipAmount),
    deliveryFee: String(p.deliveryFee),
    discount: String(p.discount),
  }));
}

interface EditPaymentsModalProps {
  open: boolean;
  order: Order;
  onClose: () => void;
  onSuccess: (updatedOrder: Order) => void;
}

/**
 * Same split-editing UI as PaymentModal (checkout), but for correcting an
 * already-COMPLETED order's payment record after the fact instead of
 * completing it for the first time - seeded from order.payments (the
 * existing rows) rather than the checkout draft in useOrderStore, and calls
 * updateOrderPayments (PUT, public/no auth) instead of completeOrder (POST).
 */
export function EditPaymentsModal({ open, order, onClose, onSuccess }: EditPaymentsModalProps) {
  const isDeliveryOrder = order.orderType === "delivery";
  const paymentRowColumns = isDeliveryOrder ? "1.3fr 1fr 0.9fr 0.9fr 0.9fr auto" : "1.3fr 1fr 0.9fr 0.9fr auto";

  const [splits, setSplits] = useState<PaymentSplitRow[]>(() => splitsFromOrder(order));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shared with PaymentModal so a correction is held to exactly the same rules
  // as the original charge - including the per-split ones the server enforces.
  const { grossOwed, totalOwed, assigned: sumNetAmount, remaining, discounts: sumDiscount } =
    settlementTotals(order.total, splits);
  const { isValid, problem, problemIndex } = validateSettlement(order.total, splits, order.orderType);

  const reset = () => {
    setSplits(splitsFromOrder(order));
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const updateSplit = (clientId: string, patch: Partial<PaymentSplitRow>) => {
    setSplits((prev) => prev.map((s) => (s.clientId === clientId ? { ...s, ...patch } : s)));
  };

  const updateTip = (clientId: string, tipAmount: string) => {
    setSplits((prev) =>
      prev.map((s) => {
        if (s.clientId !== clientId) return s;
        if (prev.length !== 1) return { ...s, tipAmount };
        const newTotal = order.total + (Number(tipAmount) || 0) + (Number(s.deliveryFee) || 0) - (Number(s.discount) || 0);
        return { ...s, tipAmount, netAmount: String(newTotal) };
      }),
    );
  };

  const updateDeliveryFee = (clientId: string, deliveryFee: string) => {
    setSplits((prev) =>
      prev.map((s) => {
        if (s.clientId !== clientId) return s;
        if (prev.length !== 1) return { ...s, deliveryFee };
        const newTotal = order.total + (Number(s.tipAmount) || 0) + (Number(deliveryFee) || 0) - (Number(s.discount) || 0);
        return { ...s, deliveryFee, netAmount: String(newTotal) };
      }),
    );
  };

  const updateDiscount = (clientId: string, discount: string) => {
    setSplits((prev) =>
      prev.map((s) => {
        if (s.clientId !== clientId) return s;
        if (prev.length !== 1) return { ...s, discount };
        const newTotal = order.total + (Number(s.tipAmount) || 0) + (Number(s.deliveryFee) || 0) - (Number(discount) || 0);
        return { ...s, discount, netAmount: String(newTotal) };
      }),
    );
  };

  const addSplit = () => {
    setSplits((prev) => [
      ...prev,
      { clientId: randomUUID(), method: "cash", netAmount: String(Math.max(remaining, 0)), tipAmount: "0", deliveryFee: "0", discount: "0" },
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
      const updatedOrder = await updateOrderPayments(order.id, toPaymentRequest(splits));
      onSuccess(updatedOrder);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron actualizar los pagos");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Editar pagos" className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between rounded-lg bg-brand-500/10 px-4 py-3">
        <span className="text-sm font-medium text-text-secondary">Total de la orden</span>
        {sumDiscount > 0 ? (
          <span className="flex items-baseline gap-1.5">
            <span className="text-sm text-text-secondary line-through">{formatCOP(grossOwed)}</span>
            <span className="text-xl font-bold text-success">{formatCOP(totalOwed)}</span>
          </span>
        ) : (
          <span className="text-xl font-bold text-brand-700">{formatCOP(totalOwed)}</span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="grid items-center gap-2 text-xs font-medium text-text-secondary" style={{ gridTemplateColumns: paymentRowColumns }}>
          <span>Método de pago</span>
          <span>Monto cobrado</span>
          <span>Descuento</span>
          <span>Propina</span>
          {isDeliveryOrder && <span>Domicilio</span>}
          <span />
        </div>

        {splits.map((split, index) => (
          <div
            key={split.clientId}
            className={index === problemIndex ? "grid items-center gap-2 rounded-lg ring-1 ring-danger" : "grid items-center gap-2"}
            style={{ gridTemplateColumns: paymentRowColumns }}
          >
            <select
              value={split.method}
              onChange={(e) => updateSplit(split.clientId, { method: e.target.value as PaymentMethod })}
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
              onChange={(e) => updateSplit(split.clientId, { netAmount: e.target.value })}
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
                onChange={(e) => updateDeliveryFee(split.clientId, e.target.value)}
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

        <button type="button" onClick={addSplit} className="self-start text-sm font-medium text-brand-600 hover:text-brand-700">
          + Dividir en otro método de pago
        </button>
      </div>

      <div className="mt-4 flex flex-col gap-1 text-sm">
        <div className="flex justify-between text-text-secondary">
          <span>Asignado</span>
          <span className={remaining !== 0 ? "font-medium text-danger" : "font-medium text-success"}>{formatCOP(sumNetAmount)}</span>
        </div>
        {remaining !== 0 && (
          <div className="flex justify-between text-text-secondary">
            <span>{remaining > 0 ? "Falta" : "Sobra"}</span>
            <span className="font-medium text-danger">{formatCOP(Math.abs(remaining))}</span>
          </div>
        )}
      </div>

      {!isValid && problem && !error && <p className="mt-2 text-sm text-text-secondary">{problem}</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!isValid || submitting}
        className="mt-4 w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-50"
      >
        {submitting ? "Guardando..." : "Guardar cambios"}
      </button>
    </Modal>
  );
}
