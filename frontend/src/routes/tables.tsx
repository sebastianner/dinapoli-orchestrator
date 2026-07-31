import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Bike, LayoutGrid, Map, ShoppingBag } from 'lucide-react';
import classNames from 'classnames';
import { useTables } from '@/lib/queries';
import { useOrderStore } from '@/store/useOrderStore';
import { useSessionStore } from '@/store/useSessionStore';
import { useToastStore } from '@/store/useToastStore';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { TableTile } from '@/components/table/TableTile';
import { TablesFloorPlanView } from '@/components/table/TablesFloorPlanView';
import { CustomerInfoModal } from '@/components/table/CustomerInfoModal';
import type { CustomerDisplayInfo } from '@/store/useOrderStore';
import type { Order, RestaurantTableSummary } from '@/types/api';

export const Route = createFileRoute('/tables')({
  component: TablesPage,
});

type TablesView = 'grid' | 'floorplan';
const VIEW_STORAGE_KEY = 'dinapoli:tablesView';
// Dragging a floor plan on a phone-sized screen isn't practical, so the
// selector only shows - and the floor plan can only be picked - from tablet
// width up (matches Tailwind's `md` breakpoint).
const TABLET_UP_QUERY = '(min-width: 768px)';

function initialView(): TablesView {
  return localStorage.getItem(VIEW_STORAGE_KEY) === 'floorplan' ? 'floorplan' : 'grid';
}

function TablesPage() {
  const { data: tables = [], isLoading } = useTables();
  const activeOrders = useOrderStore((s) => s.activeOrders);
  const startDraft = useOrderStore((s) => s.startDraft);
  const openExistingOrder = useOrderStore((s) => s.openExistingOrder);
  const setPendingDeliveryFee = useOrderStore((s) => s.setPendingDeliveryFee);
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
  const isTabletUp = useMediaQuery(TABLET_UP_QUERY);
  const isAdmin = useSessionStore((s) => s.employee?.role === 'admin');

  const [view, setView] = useState<TablesView>(initialView);
  const effectiveView: TablesView = isTabletUp ? view : 'grid';

  const [customerModalType, setCustomerModalType] = useState<'takeaway' | 'delivery' | null>(null);

  const changeView = (next: TablesView) => {
    setView(next);
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  };

  const handleTableClick = (table: RestaurantTableSummary) => {
    if (table.status === 'busy') {
      const existingOrder = activeOrders.find((o) => o.tableNumber === table.number);
      if (existingOrder) {
        openExistingOrder(existingOrder.id);
        pushToast(`La mesa ${table.number} ya está ocupada. Puedes agregar más productos a esa orden.`, 'warning');
        navigate({ to: '/menu' });
        return;
      }
      // Table is flagged busy but no matching active order is loaded (stale flag) — fall back to starting fresh.
      pushToast(`La mesa ${table.number} ya está ocupada.`, 'warning');
    }

    startDraft({ orderType: 'dine_in', tableNumber: table.number });
    navigate({ to: '/menu' });
  };

  // Shortcut to /ajustes/table-assignments for admins (see Todo.MD "Edit table
  // number") - opens straight to that order's edit modal instead of the full list.
  const handleEditTable = (order: Order) => {
    navigate({ to: '/ajustes/table-assignments', search: { orderId: order.id } });
  };

  const handleCustomerSubmit = (
    customerId: number,
    customerAddressId: number | undefined,
    customerDisplay: CustomerDisplayInfo,
    deliveryFee: number | null,
  ) => {
    if (!customerModalType) return;
    startDraft({ orderType: customerModalType, customerId, customerAddressId, customerDisplay });
    // startDraft resets pendingDeliveryFee to 0 - apply the neighborhood's fee (already known
    // client-side, no extra DB round trip) right after, so the "Domicilio" field in the order
    // overview starts pre-filled instead of making staff type it in every time.
    if (deliveryFee != null) setPendingDeliveryFee(deliveryFee);
    setCustomerModalType(null);
    navigate({ to: '/menu' });
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:gap-6 sm:p-6 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary sm:text-2xl">Mesas</h1>

        {isTabletUp && (
          <div className="flex rounded-xl border border-border bg-surface p-1" role="tablist" aria-label="Vista de mesas">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'grid'}
              onClick={() => changeView('grid')}
              className={classNames(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors duration-fast',
                view === 'grid' ? 'bg-brand-500 text-white' : 'text-text-secondary hover:text-brand-600',
              )}
            >
              <LayoutGrid size={15} /> Cuadrícula
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'floorplan'}
              onClick={() => changeView('floorplan')}
              className={classNames(
                'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors duration-fast',
                view === 'floorplan' ? 'bg-brand-500 text-white' : 'text-text-secondary hover:text-brand-600',
              )}
            >
              <Map size={15} /> Plano
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-text-secondary">Cargando mesas...</p>
      ) : effectiveView === 'grid' ? (
        <div className="flex min-w-0 flex-1 flex-col gap-6 md:flex-row md:gap-8">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-3 sm:gap-5">
              {tables.map((table) => {
                const order = table.status === 'busy' ? activeOrders.find((o) => o.tableNumber === table.number) : undefined;
                return (
                  <TableTile
                    key={table.number}
                    table={table}
                    order={order}
                    onClick={() => handleTableClick(table)}
                    onEditTable={isAdmin && order ? () => handleEditTable(order) : undefined}
                  />
                );
              })}
            </div>
          </div>

          <div className="mb-20 flex flex-row gap-3 md:mb-0 md:w-48 md:shrink-0 md:flex-col md:gap-4 md:pt-2">
            <button
              type="button"
              onClick={() => setCustomerModalType('delivery')}
              className="flex flex-1 flex-col items-center gap-2 rounded-2xl border-2 border-border bg-surface py-4 text-text-primary shadow-sm transition-transform duration-fast hover:scale-105 hover:border-brand-400 active:scale-95 md:py-6"
            >
              <Bike size={28} className="text-brand-600" />
              <span className="text-sm font-semibold">Domicilio</span>
            </button>

            <button
              type="button"
              onClick={() => setCustomerModalType('takeaway')}
              className="flex flex-1 flex-col items-center gap-2 rounded-2xl border-2 border-border bg-surface py-4 text-text-primary shadow-sm transition-transform duration-fast hover:scale-105 hover:border-brand-400 active:scale-95 md:py-6"
            >
              <ShoppingBag size={28} className="text-brand-600" />
              <span className="text-sm font-semibold">Para llevar</span>
            </button>
          </div>
        </div>
      ) : (
        <TablesFloorPlanView
          tables={tables}
          activeOrders={activeOrders}
          onTableClick={handleTableClick}
          onEditTable={isAdmin ? handleEditTable : undefined}
          onDeliveryClick={() => setCustomerModalType('delivery')}
          onTakeawayClick={() => setCustomerModalType('takeaway')}
        />
      )}

      <CustomerInfoModal
        open={customerModalType != null}
        orderType={customerModalType ?? 'takeaway'}
        onClose={() => setCustomerModalType(null)}
        onSubmit={handleCustomerSubmit}
      />
    </div>
  );
}
