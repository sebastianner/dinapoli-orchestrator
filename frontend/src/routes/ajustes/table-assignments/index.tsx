import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import classNames from 'classnames';
import { Pencil } from 'lucide-react';
import { useOrdersByFilter, useTables } from '@/lib/queries';
import { formatCOP } from '@/lib/format';
import { formatTime } from '@/lib/date';
import { TableNumberEditModal } from '@/components/order/TableNumberEditModal';
import { TableCountEditor } from '@/components/table/TableCountEditor';
import type { Order, OrderStatus } from '@/types/api';

interface TableAssignmentsSearch {
  /** Set by the /tables shortcut (see TableTile/TablesFloorPlanView) to open a specific order's modal directly instead of leaving the admin to find it in the list. */
  orderId?: number;
}

export const Route = createFileRoute('/ajustes/table-assignments/')({
  validateSearch: (search: Record<string, unknown>): TableAssignmentsSearch => ({
    orderId: typeof search.orderId === 'string' || typeof search.orderId === 'number' ? Number(search.orderId) : undefined,
  }),
  // Admin-only - enforced by the parent /ajustes layout's beforeLoad.
  component: TableAssignmentsPage,
});

const statusStyles: Record<OrderStatus, string> = {
  PENDING: 'bg-warning-bg text-warning',
  PRINTING: 'bg-warning-bg text-warning',
  ACTIVE: 'bg-brand-500/10 text-brand-600',
  COMPLETED: 'bg-success-bg text-success',
};

const statusLabels: Record<OrderStatus, string> = {
  PENDING: 'Pendiente',
  PRINTING: 'Imprimiendo',
  ACTIVE: 'Activa',
  COMPLETED: 'Completada',
};

function TableAssignmentsPage() {
  const { orderId } = Route.useSearch();
  const { data: orders = [], isLoading } = useOrdersByFilter({ orderType: 'dine_in' });
  const { data: tables = [] } = useTables();
  const [editing, setEditing] = useState<Order | null>(null);

  const openOrders = useMemo(
    () =>
      orders
        .filter((o) => o.status !== 'COMPLETED')
        .sort((a, b) => (a.tableNumber ?? 0) - (b.tableNumber ?? 0)),
    [orders]
  );

  // Deep-link from the /tables shortcut - open the matching order the moment it's loaded.
  useEffect(() => {
    if (orderId == null) return;
    const match = openOrders.find((o) => o.id === orderId);
    if (match) setEditing(match);
  }, [orderId, openOrders]);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-text-primary">Editar mesas</h1>

      {tables.length > 0 && <TableCountEditor currentCount={tables.length} />}

      <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-secondary">Reasignar órdenes</p>
      {isLoading ? (
        <p className="text-sm text-text-secondary">Cargando...</p>
      ) : openOrders.length === 0 ? (
        <p className="text-sm text-text-secondary">No hay órdenes de mesa abiertas.</p>
      ) : (
        <div className="flex max-w-xl flex-col gap-2">
          {openOrders.map((order) => (
            <div key={order.id} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-text-primary">Mesa {order.tableNumber}</span>
                  <span className={classNames('rounded-full px-2 py-0.5 text-xs font-medium', statusStyles[order.status])}>{statusLabels[order.status]}</span>
                </div>
                <p className="text-sm text-text-secondary">
                  Orden #{order.id} · {formatCOP(order.grandTotal)} · {formatTime(order.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditing(order)}
                className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
              >
                <Pencil size={14} /> Editar mesa
              </button>
            </div>
          ))}
        </div>
      )}

      <TableNumberEditModal order={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
