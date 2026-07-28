import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { useOrderStore } from "@/store/useOrderStore";
import { usePromoSettings } from "@/lib/queries";
import { formatCOP } from "@/lib/format";
import type { PromoType } from "@/types/api";

export const Route = createFileRoute("/menu/promos")({
  component: PromosPage,
});

const PROMO_META: { type: PromoType; title: string; description: string }[] = [
  {
    type: "duo",
    title: "Dúo",
    description:
      "Elige 2: pizza personal (un solo sabor), lasaña, pasta o gratinado, en cualquier combinación.",
  },
  {
    type: "pizza_xl",
    title: "Pizza XL",
    description:
      "Pizza XL (hasta 4 sabores) + gaseosa personal y panes al gratín de regalo.",
  },
];

function PromosPage() {
  const startPromo = useOrderStore((s) => s.startPromo);
  const navigate = useNavigate();
  const { data: promoSettings = [] } = usePromoSettings();

  const handleSelect = (type: PromoType) => {
    startPromo(type);
    navigate({ to: "/menu/todos" });
  };

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-text-primary">
        Promociones
      </h1>
      <div className="flex flex-wrap gap-4">
        {PROMO_META.map((promo) => {
          const settings = promoSettings.find(
            (s) => s.promoType === promo.type,
          );
          const priceLabel = settings
            ? promo.type === "duo"
              ? `2x${formatCOP(settings.price)}`
              : formatCOP(settings.price)
            : "...";
          return (
            <button
              key={promo.type}
              type="button"
              onClick={() => handleSelect(promo.type)}
              className="anim-scale-in flex w-64 flex-col items-start gap-2 rounded-2xl border border-border bg-surface p-5 text-left shadow-sm transition-transform duration-fast hover:scale-105 hover:border-brand-400 active:scale-95"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">
                <Sparkles size={20} />
              </span>
              <div className="flex items-baseline gap-2">
                <h2 className="text-lg font-semibold text-text-primary">
                  {promo.title}
                </h2>
                <span className="font-semibold text-brand-700">
                  {priceLabel}
                </span>
              </div>
              <p className="text-sm text-text-secondary">{promo.description}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
