import { useState } from 'react';
import { Info } from 'lucide-react';
import type { HeatmapCell } from '@/types/api';

// dow from the API is 0 (Sunday) - 6 (Saturday); reordered to start the week
// on Monday since that reads more naturally for a restaurant's weekly rhythm.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS: Record<number, string> = { 0: 'Dom', 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb' };
const HOURS = Array.from({ length: 24 }, (_, h) => h);

interface BusyHeatmapProps {
  cells: HeatmapCell[];
}

/** Plain div grid (no SVG) - 7 day-rows x 24 hour-columns, opacity scaled by order count. */
export function BusyHeatmap({ cells }: BusyHeatmapProps) {
  const [hovered, setHovered] = useState<{ dow: number; hour: number } | null>(null);
  const byKey = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.orderCount]));
  const max = Math.max(...cells.map((c) => c.orderCount), 1);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-3 flex items-center gap-1 text-sm font-semibold text-text-secondary">
        Cuándo estamos ocupados
        <span title="Cantidad de órdenes recibidas por día y hora en el periodo seleccionado." className="cursor-help">
          <Info size={13} className="shrink-0 text-text-secondary" />
        </span>
      </h3>
      <div className="overflow-x-auto">
        <div className="inline-flex flex-col gap-[3px]">
          {DAY_ORDER.map((dow) => (
            <div key={dow} className="flex items-center gap-[3px]">
              <span className="w-8 shrink-0 text-[10px] text-text-secondary">{DAY_LABELS[dow]}</span>
              {HOURS.map((hour) => {
                const count = byKey.get(`${dow}-${hour}`) ?? 0;
                const isHovered = hovered?.dow === dow && hovered?.hour === hour;
                return (
                  <div
                    key={hour}
                    className="h-4 w-4 shrink-0 rounded-[3px] bg-brand-500"
                    style={{ opacity: count === 0 ? 0.06 : 0.15 + (count / max) * 0.85 }}
                    onMouseEnter={() => setHovered({ dow, hour })}
                    onMouseLeave={() => setHovered(null)}
                    title={`${DAY_LABELS[dow]} ${String(hour).padStart(2, '0')}:00 - ${count} ${count === 1 ? 'orden' : 'órdenes'}`}
                  >
                    {isHovered && <span className="sr-only">{count}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="mt-1 flex items-center gap-[3px] pl-8">
            {HOURS.map((hour) => (
              <span key={hour} className="w-4 shrink-0 text-center text-[8px] text-text-secondary">
                {hour % 3 === 0 ? hour : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
