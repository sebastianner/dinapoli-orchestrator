import { useState } from 'react';
import { formatCOP } from '@/lib/format';
import type { Order } from '@/types/api';

function hourLabel(hour: number): string | null {
  if (hour % 3 !== 0) return null;
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/** Bogotá is UTC-5 with no DST; shifting the UTC hour is enough to bucket correctly. */
function bogotaHour(isoString: string): number {
  const utcHour = new Date(isoString).getUTCHours();
  return (utcHour - 5 + 24) % 24;
}

function hourlySales(orders: Order[]): number[] {
  const buckets = new Array(24).fill(0) as number[];
  for (const order of orders) {
    if (order.status !== 'COMPLETED' || !order.completedAt) continue;
    const hour = bogotaHour(order.completedAt);
    buckets[hour] += order.total + order.deliveryFee;
  }
  return buckets;
}

interface HourlySalesChartProps {
  orders: Order[];
}

export function HourlySalesChart({ orders }: HourlySalesChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const buckets = hourlySales(orders);
  const max = Math.max(...buckets, 1);
  const peakHour = buckets.indexOf(Math.max(...buckets));

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-4 font-semibold text-text-primary">Ventas por hora</h3>

      <div className="relative flex h-48 items-end gap-[3px]">
        {hovered != null && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-text-primary px-2 py-1 text-xs font-medium text-bg shadow-md"
            style={{ left: `${((hovered + 0.5) / 24) * 100}%`, top: `${100 - (buckets[hovered] / max) * 100}%` }}
          >
            {formatCOP(buckets[hovered])}
          </div>
        )}

        {buckets.map((value, hour) => (
          <div
            key={hour}
            className="group relative h-full flex-1"
            onMouseEnter={() => setHovered(hour)}
            onMouseLeave={() => setHovered((h) => (h === hour ? null : h))}
          >
            <div
              className="absolute inset-x-0 bottom-0 rounded-t bg-brand-500 transition-colors duration-fast group-hover:bg-brand-600"
              style={{ height: `${(value / max) * 100}%` }}
            />
            {hour === peakHour && value > 0 && (
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-brand-700">
                {formatCOP(value)}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-2 flex gap-[3px] text-[11px] text-text-secondary">
        {buckets.map((_, hour) => (
          <span key={hour} className="flex-1 text-center">
            {hourLabel(hour)}
          </span>
        ))}
      </div>
    </div>
  );
}
