import { useState } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Pencil, Sparkles } from 'lucide-react';
import { usePromoSettings } from '@/lib/queries';
import { useSessionStore } from '@/store/useSessionStore';
import { formatCOP } from '@/lib/format';
import { PROMO_LABELS } from '@/lib/promos';
import { PromoSettingsModal } from '@/components/promo/PromoSettingsModal';
import type { PromoSettings } from '@/types/api';

export const Route = createFileRoute('/dashboard/promos/')({
  beforeLoad: () => {
    // Promo pricing is operational config, same footing as cash-flow settings
    // and delivery zones (see routes/promos.ts) - admin only.
    if (useSessionStore.getState().employee?.role !== 'admin') {
      throw redirect({ to: '/dashboard/order-history' });
    }
  },
  component: PromosAdminPage,
});

function PromosAdminPage() {
  const { data: promoSettings = [], isLoading } = usePromoSettings();
  const [editing, setEditing] = useState<PromoSettings | null>(null);

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold text-text-primary">Promociones</h1>

      {isLoading ? (
        <p className="text-sm text-text-secondary">Cargando...</p>
      ) : (
        <div className="flex flex-col gap-3">
          {promoSettings.map((settings) => (
            <div key={settings.promoType} className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">
                <Sparkles size={20} />
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-text-primary">{PROMO_LABELS[settings.promoType]}</p>
                <p className="text-xs text-text-secondary">
                  Precio: {formatCOP(settings.price)}
                  {settings.promoType === 'pizza_xl' && <> · Recargo gaseosa: {formatCOP(settings.sodaSurcharge)}</>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditing(settings)}
                className="flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
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
