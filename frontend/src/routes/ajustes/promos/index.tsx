import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Pencil, Sparkles } from 'lucide-react';
import { usePromoSettings } from '@/lib/queries';
import { formatCOP } from '@/lib/format';
import { PROMO_LABELS } from '@/lib/promos';
import { PromoSettingsModal } from '@/components/promo/PromoSettingsModal';
import type { PromoSettings } from '@/types/api';

export const Route = createFileRoute('/ajustes/promos/')({
  // Admin-only - enforced by the parent /ajustes layout's beforeLoad.
  component: PromosAdminPage,
});

function PromosAdminPage() {
  const { data: promoSettings = [], isLoading } = usePromoSettings();
  const [editing, setEditing] = useState<PromoSettings | null>(null);

  return (
    <div className="p-4 sm:p-6">
      <h1 className="mb-6 text-xl font-semibold text-text-primary">Promociones</h1>

      {isLoading ? (
        <p className="text-sm text-text-secondary">Cargando...</p>
      ) : (
        <div className="flex flex-col gap-3">
          {promoSettings.map((settings) => (
            <div key={settings.promoType} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">
                  <Sparkles size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary">{PROMO_LABELS[settings.promoType]}</p>
                  <p className="text-xs text-text-secondary">
                    Precio: {formatCOP(settings.price)}
                    {settings.promoType === 'pizza_xl' && <> · Recargo gaseosa: {formatCOP(settings.sodaSurcharge)}</>}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditing(settings)}
                className="flex w-full items-center justify-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600 sm:w-auto"
              >
                <Pencil size={12} /> Editar precio
              </button>
            </div>
          ))}
        </div>
      )}

      <PromoSettingsModal open={editing != null} onClose={() => setEditing(null)} settings={editing} />
    </div>
  );
}
