import { useEffect, useState } from "react";
import { mutate } from "swr";
import { AlertTriangle } from "lucide-react";
import { Modal } from "@/components/common/Modal";
import { updatePromoSettings as savePromoSettings } from "@/lib/api";
import { formatCOP } from "@/lib/format";
import { PROMO_LABELS } from "@/lib/promos";
import { useToastStore } from "@/store/useToastStore";
import type { PromoSettings } from "@/types/api";

interface PromoSettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: PromoSettings | null;
}

/** Admin only (see routes/promos.ts PUT /:type) - two-step (edit, then confirm) per the todo's
 * "confirmation prompts to prevent accidental changes" requirement, same spirit as DeleteOrderModal. */
export function PromoSettingsModal({
  open,
  onClose,
  settings,
}: PromoSettingsModalProps) {
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [price, setPrice] = useState("");
  const [sodaSurcharge, setSodaSurcharge] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushToast = useToastStore((s) => s.push);

  useEffect(() => {
    if (!open || !settings) return;
    setStep("edit");
    setPrice(String(settings.price));
    setSodaSurcharge(String(settings.sodaSurcharge));
    setError(null);
  }, [open, settings]);

  const handleClose = () => {
    setError(null);
    onClose();
  };

  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedPrice = Number(price);
    if (!Number.isInteger(parsedPrice) || parsedPrice <= 0) {
      setError("El precio debe ser un número entero mayor a 0");
      return;
    }
    if (settings?.promoType === "pizza_xl") {
      const parsedSurcharge = Number(sodaSurcharge);
      if (!Number.isInteger(parsedSurcharge) || parsedSurcharge < 0) {
        setError(
          "El recargo de gaseosa debe ser un número entero mayor o igual a 0",
        );
        return;
      }
    }
    setError(null);
    setStep("confirm");
  };

  const handleConfirm = async () => {
    if (!settings) return;
    setSubmitting(true);
    setError(null);
    try {
      await savePromoSettings(
        settings.promoType,
        Number(price),
        settings.promoType === "pizza_xl" ? Number(sodaSurcharge) : undefined,
      );
      await mutate("/promos");
      pushToast(`Precio de ${PROMO_LABELS[settings.promoType]} actualizado`);
      handleClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo guardar el precio",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!settings) return null;

  const priceChanged = Number(price) !== settings.price;
  const surchargeChanged =
    settings.promoType === "pizza_xl" &&
    Number(sodaSurcharge) !== settings.sodaSurcharge;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={`Editar precio - ${PROMO_LABELS[settings.promoType]}`}
    >
      {step === "edit" ? (
        <form onSubmit={handleContinue} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-secondary">
              Precio
            </span>
            <input
              autoFocus
              type="number"
              min={1}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
            />
          </label>

          {settings.promoType === "pizza_xl" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-secondary">
                Recargo por gaseosa (Coca-Cola/Quatro)
              </span>
              <input
                type="number"
                min={0}
                value={sodaSurcharge}
                onChange={(e) => setSodaSurcharge(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-brand-400"
              />
            </label>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600"
          >
            Continuar
          </button>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning-bg text-warning">
            <AlertTriangle size={28} />
          </div>

          <p className="text-sm text-text-primary">
            Vas a actualizar el precio de {PROMO_LABELS[settings.promoType]}:
          </p>

          <div className="w-full rounded-xl border border-border bg-surface p-3 text-left text-sm">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary">Precio</span>
              <span
                className={
                  priceChanged
                    ? "font-semibold text-brand-700"
                    : "text-text-primary"
                }
              >
                {formatCOP(settings.price)}{" "}
                {priceChanged && <>→ {formatCOP(Number(price))}</>}
              </span>
            </div>
            {settings.promoType === "pizza_xl" && (
              <div className="mt-1 flex items-center justify-between">
                <span className="text-text-secondary">Recargo gaseosa</span>
                <span
                  className={
                    surchargeChanged
                      ? "font-semibold text-brand-700"
                      : "text-text-primary"
                  }
                >
                  {formatCOP(settings.sodaSurcharge)}{" "}
                  {surchargeChanged && (
                    <>→ {formatCOP(Number(sodaSurcharge))}</>
                  )}
                </span>
              </div>
            )}
          </div>

          <p className="text-xs text-text-secondary">
            Este precio aplica de inmediato a toda nueva orden con esta
            promoción.
          </p>

          {error && <p className="text-sm text-danger">{error}</p>}

          <div className="flex w-full gap-3">
            <button
              type="button"
              onClick={() => setStep("edit")}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm font-semibold text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
            >
              Atrás
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting}
              className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
            >
              {submitting ? "Guardando..." : "Confirmar cambio"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
