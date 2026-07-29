import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { AlertTriangle, Sparkles, X } from 'lucide-react';
import { useMenu, useOrder, usePromoSettings } from '@/lib/queries';
import { useOrderStore } from '@/store/useOrderStore';
import { CategorySidebar } from '@/components/menu/CategorySidebar';
import { OrderOverview } from '@/components/order/OrderOverview';
import { OrderContextBar } from '@/components/menu/OrderContextBar';
import { promoProgressText } from '@/lib/promos';

export const Route = createFileRoute('/menu')({
  component: MenuLayout,
});

function MenuLayout() {
  const { data: menu, isLoading } = useMenu();
  const currentOrderId = useOrderStore((s) => s.currentOrderId);
  const newOrderInfo = useOrderStore((s) => s.newOrderInfo);
  const promoDraft = useOrderStore((s) => s.promoDraft);
  const cancelPromo = useOrderStore((s) => s.cancelPromo);
  const hasOrderContext = currentOrderId != null || newOrderInfo != null;
  const { data: promoSettings = [] } = usePromoSettings();
  const activePromoSettings = promoDraft ? promoSettings.find((s) => s.promoType === promoDraft.type) : undefined;

  // Same source either way (an order already placed vs. a not-yet-submitted
  // draft) - existingOrder wins once loaded since it's the authoritative one.
  const { data: existingOrder } = useOrder(currentOrderId);
  const orderType = existingOrder?.orderType ?? newOrderInfo?.orderType;
  const tableNumber = existingOrder?.tableNumber ?? newOrderInfo?.tableNumber;
  const customerName = existingOrder?.customerName ?? newOrderInfo?.customerDisplay?.name;
  const customerAddress = existingOrder?.address ?? newOrderInfo?.customerDisplay?.address;

  return (
    <div className="flex h-full">
      {menu && <CategorySidebar menu={menu} />}

      <div className="flex min-w-0 flex-1 flex-col">
        {!hasOrderContext && (
          <div className="flex items-center justify-between gap-4 border-b border-warning/30 bg-warning-bg px-6 py-3">
            <span className="flex items-center gap-2 text-sm font-medium text-warning">
              <AlertTriangle size={16} /> Elige una mesa, domicilio o para llevar antes de agregar productos.
            </span>
            <Link
              to="/tables"
              className="shrink-0 rounded-full bg-warning px-4 py-1.5 text-sm font-semibold text-white transition-opacity duration-fast hover:opacity-90"
            >
              Ir a mesas
            </Link>
          </div>
        )}

        {orderType && (
          <OrderContextBar orderType={orderType} tableNumber={tableNumber} customerName={customerName} customerAddress={customerAddress} />
        )}

        {promoDraft && activePromoSettings && (
          <div className="flex items-center justify-between gap-4 border-b border-brand-400/30 bg-brand-500/10 px-6 py-3">
            <span className="flex items-center gap-2 text-sm font-medium text-brand-700">
              <Sparkles size={16} /> {promoProgressText(promoDraft.type, promoDraft.items.length, activePromoSettings)}
            </span>
            <button
              type="button"
              onClick={cancelPromo}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-brand-400 px-3 py-1 text-xs font-semibold text-brand-700 transition-colors duration-fast hover:bg-brand-500/10"
            >
              <X size={13} /> Cancelar promo
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? <p className="text-sm text-text-secondary">Cargando menú...</p> : <Outlet />}
        </div>
      </div>

      <OrderOverview />
    </div>
  );
}
