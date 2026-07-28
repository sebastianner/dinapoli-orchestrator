import { useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { Bike, Check, Pencil, ShoppingBag } from 'lucide-react';
import { timeAgo } from '@/lib/date';
import { defaultTablePosition, loadTablePositions, saveTablePosition, type TablePosition } from '@/lib/tablePositions';
import type { Order, RestaurantTableSummary } from '@/types/api';

interface TablesFloorPlanViewProps {
  tables: RestaurantTableSummary[];
  activeOrders: Order[];
  onTableClick: (table: RestaurantTableSummary) => void;
  /** Admin-only shortcut to /ajustes/table-assignments for a table's order (see Todo.MD "Edit table number"). Omitted -> no edit affordance shown. Hidden while dragging (editMode) so it doesn't fight the drag gesture. */
  onEditTable?: (order: Order) => void;
  onDeliveryClick: () => void;
  onTakeawayClick: () => void;
}

/** "hace 6 minutos" -> "6 min" - the tile is too small for the full phrase. */
function shortElapsed(iso: string): string {
  return timeAgo(iso)
    .replace('hace ', '')
    .replace(/\bminutos?\b/, 'min')
    .replace(/\bhoras?\b/, 'h')
    .replace(/\bdías?\b/, 'd');
}

export function TablesFloorPlanView({ tables, activeOrders, onTableClick, onEditTable, onDeliveryClick, onTakeawayClick }: TablesFloorPlanViewProps) {
  const floorRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<number | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [positions, setPositions] = useState<Record<number, TablePosition>>({});

  // Seeds any table without a saved position (new table, or first time this
  // view is opened) from an even default layout - runs whenever the set of
  // tables changes, not on every render.
  useEffect(() => {
    const stored = loadTablePositions();
    setPositions((prev) => {
      const next = { ...prev };
      for (const table of tables) {
        if (!next[table.number]) {
          next[table.number] = stored[table.number] ?? defaultTablePosition(table.number, tables.length);
        }
      }
      return next;
    });
  }, [tables]);

  const handlePointerDown = (e: React.PointerEvent, tableNumber: number) => {
    if (!editMode) return;
    e.preventDefault();
    draggingRef.current = tableNumber;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const tableNumber = draggingRef.current;
    const floor = floorRef.current;
    if (tableNumber == null || !floor) return;
    const rect = floor.getBoundingClientRect();
    const xPct = Math.min(96, Math.max(4, ((e.clientX - rect.left) / rect.width) * 100));
    const yPct = Math.min(94, Math.max(10, ((e.clientY - rect.top) / rect.height) * 100));
    setPositions((prev) => ({ ...prev, [tableNumber]: { xPct, yPct } }));
  };

  const endDrag = () => {
    const tableNumber = draggingRef.current;
    draggingRef.current = null;
    if (tableNumber == null) return;
    const position = positions[tableNumber];
    if (position) saveTablePosition(tableNumber, position);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          {editMode ? 'Arrastra las mesas para acomodar el plano - se guarda en este dispositivo.' : 'Plano del salón.'}
        </p>
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          className={classNames(
            'flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors duration-fast',
            editMode ? 'border-brand-500 bg-brand-500 text-white' : 'border-border bg-surface text-text-secondary hover:border-brand-400 hover:text-brand-600',
          )}
        >
          {editMode ? <Check size={15} /> : <Pencil size={15} />}
          {editMode ? 'Listo' : 'Editar plano'}
        </button>
      </div>

      <div
        ref={floorRef}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        className="relative min-h-[420px] flex-1 select-none overflow-hidden rounded-2xl border-2 border-dashed border-border bg-surface"
      >
        <div className="flex h-10 items-center justify-center border-b border-dashed border-border bg-bg text-xs font-bold uppercase tracking-widest text-text-secondary">
          Cocina
        </div>

        {tables.map((table) => {
          const position = positions[table.number];
          if (!position) return null;
          const isFree = table.status === 'free';
          const order = !isFree ? activeOrders.find((o) => o.tableNumber === table.number) : undefined;

          return (
            <div key={table.number} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${position.xPct}%`, top: `${position.yPct}%` }}>
              <button
                type="button"
                onPointerDown={(e) => handlePointerDown(e, table.number)}
                onClick={() => {
                  if (!editMode) onTableClick(table);
                }}
                className={classNames(
                  'flex h-16 w-16 touch-none flex-col items-center justify-center rounded-full border-2 text-sm font-bold shadow-sm',
                  'transition-transform duration-fast',
                  editMode ? 'cursor-grab active:cursor-grabbing' : 'hover:scale-105 active:scale-95',
                  isFree ? 'border-table-free/50 bg-table-free-bg text-table-free' : 'border-table-busy/50 bg-table-busy-bg text-table-busy',
                )}
              >
                <span>{table.number}</span>
                {order && <span className="text-[0.58rem] font-semibold leading-none">{shortElapsed(order.createdAt)}</span>}
              </button>

              {!editMode && onEditTable && order && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditTable(order);
                  }}
                  title="Editar mesa"
                  aria-label="Editar mesa"
                  className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-md bg-surface text-table-busy shadow-sm transition-colors duration-fast hover:bg-surface-raised"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          );
        })}

        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
          <button
            type="button"
            onClick={onDeliveryClick}
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 text-xs font-semibold text-text-primary shadow-sm transition-colors duration-fast hover:border-brand-400"
          >
            <Bike size={14} className="text-brand-600" /> Domicilio
          </button>
          <button
            type="button"
            onClick={onTakeawayClick}
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 text-xs font-semibold text-text-primary shadow-sm transition-colors duration-fast hover:border-brand-400"
          >
            <ShoppingBag size={14} className="text-brand-600" /> Para llevar
          </button>
        </div>
      </div>
    </div>
  );
}
