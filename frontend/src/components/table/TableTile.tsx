import classNames from 'classnames';
import type { RestaurantTableSummary } from '@/types/api';

interface TableTileProps {
  table: RestaurantTableSummary;
  onClick: () => void;
}

export function TableTile({ table, onClick }: TableTileProps) {
  const isFree = table.status === 'free';

  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        'anim-scale-in flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-2xl border-2 shadow-sm',
        'transition-transform duration-fast hover:scale-105 active:scale-95',
        isFree
          ? 'border-table-free/30 bg-table-free-bg text-table-free'
          : 'border-table-busy/30 bg-table-busy-bg text-table-busy',
      )}
    >
      <span className="text-3xl font-bold">{table.number}</span>
      <span className="text-xs font-medium uppercase tracking-wide">{isFree ? 'Libre' : 'Ocupada'}</span>
    </button>
  );
}
