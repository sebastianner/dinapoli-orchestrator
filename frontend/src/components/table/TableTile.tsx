import classNames from 'classnames';
import { Pencil } from 'lucide-react';
import { formatCOP } from '@/lib/format';
import { timeAgo } from '@/lib/date';
import type { Order, RestaurantTableSummary } from '@/types/api';

interface TableTileProps {
  table: RestaurantTableSummary;
  /** The table's active order, when busy - shown as elapsed time/total/item count. Omitted (even for a busy table) when the status flag is stale and no matching order is loaded, falling back to the plain "Ocupada" label. */
  order?: Order;
  onClick: () => void;
  /** Admin-only shortcut to /dashboard/table-assignments for this table's order (see Todo.MD "Edit table number"). Omitted -> no edit affordance, e.g. non-admins or a free table with nothing to reassign. */
  onEditTable?: () => void;
}

export function TableTile({ table, order, onClick, onEditTable }: TableTileProps) {
  const isFree = table.status === 'free';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        className={classNames(
          'anim-scale-in flex h-28 w-28 flex-col rounded-2xl border-2 shadow-sm',
          'transition-transform duration-fast hover:scale-105 active:scale-95',
          isFree
            ? 'items-center justify-center gap-1 border-table-free/30 bg-table-free-bg text-table-free'
            : 'items-stretch justify-center gap-1 border-table-busy/30 bg-table-busy-bg px-3 text-table-busy',
        )}
      >
        {isFree ? (
          <>
            <span className="text-3xl font-bold">{table.number}</span>
            <span className="text-xs font-medium uppercase tracking-wide">Libre</span>
          </>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold">{table.number}</span>
              <span className="text-[0.62rem] font-semibold uppercase tracking-wide">Ocupada</span>
            </div>
            {order && (
              <div className="flex flex-col gap-0.5 text-left text-[0.68rem] leading-tight opacity-90">
                <span>{timeAgo(order.createdAt)}</span>
                <span>
                  {formatCOP(order.total)} · {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                </span>
              </div>
            )}
          </>
        )}
      </button>

      {onEditTable && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditTable();
          }}
          title="Editar mesa"
          aria-label="Editar mesa"
          className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-surface/90 text-table-busy shadow-sm transition-colors duration-fast hover:bg-surface"
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
}
