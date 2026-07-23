import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { AlertTriangle } from 'lucide-react';
import { useMenu } from '@/lib/queries';
import { useOrderStore } from '@/store/useOrderStore';
import { CategorySidebar } from '@/components/menu/CategorySidebar';
import { OrderOverview } from '@/components/order/OrderOverview';

export const Route = createFileRoute('/menu')({
  component: MenuLayout,
});

function MenuLayout() {
  const { data: menu, isLoading } = useMenu();
  const currentOrderId = useOrderStore((s) => s.currentOrderId);
  const newOrderInfo = useOrderStore((s) => s.newOrderInfo);
  const hasOrderContext = currentOrderId != null || newOrderInfo != null;

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

        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? <p className="text-sm text-text-secondary">Cargando menú...</p> : <Outlet />}
        </div>
      </div>

      <OrderOverview />
    </div>
  );
}
