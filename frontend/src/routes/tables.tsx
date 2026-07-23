import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Bike, ShoppingBag } from 'lucide-react';
import { useTables } from '@/lib/queries';
import { useOrderStore } from '@/store/useOrderStore';
import { useToastStore } from '@/store/useToastStore';
import { TableTile } from '@/components/table/TableTile';
import { CustomerInfoModal } from '@/components/table/CustomerInfoModal';
import type { CustomerInfo, RestaurantTableSummary } from '@/types/api';

export const Route = createFileRoute('/tables')({
  component: TablesPage,
});

function TablesPage() {
  const { data: tables = [], isLoading } = useTables();
  const activeOrders = useOrderStore((s) => s.activeOrders);
  const startDraft = useOrderStore((s) => s.startDraft);
  const openExistingOrder = useOrderStore((s) => s.openExistingOrder);
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  const [customerModalType, setCustomerModalType] = useState<'takeaway' | 'delivery' | null>(null);

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

  const handleCustomerSubmit = (customer: CustomerInfo) => {
    if (!customerModalType) return;
    startDraft({ orderType: customerModalType, customer });
    setCustomerModalType(null);
    navigate({ to: '/menu' });
  };

  return (
    <div className="flex h-full gap-8 p-8">
      <div className="flex-1">
        <h1 className="mb-6 text-2xl font-semibold text-text-primary">Mesas</h1>

        {isLoading ? (
          <p className="text-sm text-text-secondary">Cargando mesas...</p>
        ) : (
          <div className="flex flex-wrap gap-5">
            {tables.map((table) => (
              <TableTile key={table.number} table={table} onClick={() => handleTableClick(table)} />
            ))}
          </div>
        )}
      </div>

      <div className="flex w-48 shrink-0 flex-col gap-4 pt-16">
        <button
          type="button"
          onClick={() => setCustomerModalType('delivery')}
          className="flex flex-col items-center gap-2 rounded-2xl border-2 border-border bg-surface py-6 text-text-primary shadow-sm transition-transform duration-fast hover:scale-105 hover:border-brand-400 active:scale-95"
        >
          <Bike size={28} className="text-brand-600" />
          <span className="text-sm font-semibold">Domicilio</span>
        </button>

        <button
          type="button"
          onClick={() => setCustomerModalType('takeaway')}
          className="flex flex-col items-center gap-2 rounded-2xl border-2 border-border bg-surface py-6 text-text-primary shadow-sm transition-transform duration-fast hover:scale-105 hover:border-brand-400 active:scale-95"
        >
          <ShoppingBag size={28} className="text-brand-600" />
          <span className="text-sm font-semibold">Para llevar</span>
        </button>
      </div>

      <CustomerInfoModal
        open={customerModalType != null}
        orderType={customerModalType ?? 'takeaway'}
        onClose={() => setCustomerModalType(null)}
        onSubmit={handleCustomerSubmit}
      />
    </div>
  );
}
