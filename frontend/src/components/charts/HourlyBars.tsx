import { useEffect, useMemo, useState } from 'react';
import { scaleBand, scaleLinear } from 'd3-scale';
import { max as d3max } from 'd3-array';
import { formatCOP } from '@/lib/format';
import { useMeasuredWidth } from './useMeasuredWidth';
import type { Order } from '@/types/api';

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
    buckets[hour] += order.total + order.deliveryFee - order.discount;
  }
  return buckets;
}

function hourLabel(hour: number): string | null {
  if (hour % 3 !== 0) return null;
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

const HEIGHT = 240;
const MARGIN = { top: 24, right: 4, bottom: 20, left: 4 };

interface HourlyBarsProps {
  orders: Order[];
  title?: string;
}

/**
 * D3 (scaleBand/scaleLinear) computes the layout against the container's
 * actual measured width (see useMeasuredWidth), so the chart fills its card
 * instead of being letterboxed into it. React owns the DOM; every animation
 * is a plain CSS transition - bars grow in with a per-hour stagger.
 */
export function HourlyBars({ orders, title = 'Ventas por hora' }: HourlyBarsProps) {
  const { ref: containerRef, width: measuredWidth } = useMeasuredWidth<HTMLDivElement>();
  const width = measuredWidth || 600;

  const buckets = useMemo(() => hourlySales(orders), [orders]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  const dataKey = `${width}:${buckets.join(',')}`;
  useEffect(() => {
    setMounted(false);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
    return () => cancelAnimationFrame(id);
  }, [dataKey]);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const x = scaleBand<number>()
    .domain(buckets.map((_, i) => i))
    .range([0, innerWidth])
    .padding(0.28);
  const maxValue = Math.max(d3max(buckets) ?? 0, 1);
  const y = scaleLinear().domain([0, maxValue]).range([innerHeight, 0]);

  const peakHour = buckets.indexOf(Math.max(...buckets));

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-3 font-semibold text-text-primary">{title}</h3>
      <div ref={containerRef} className="relative w-full" style={{ height: HEIGHT }}>
        {hovered != null && buckets[hovered] > 0 && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-text-primary px-2 py-1 text-xs font-medium text-bg shadow-md transition-opacity duration-fast"
            style={{
              left: `${(x(hovered) ?? 0) + x.bandwidth() / 2 + MARGIN.left}px`,
              top: `${y(buckets[hovered]) + MARGIN.top}px`,
            }}
          >
            {formatCOP(buckets[hovered])}
          </div>
        )}

        <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} className="overflow-visible">
          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            {buckets.map((value, hour) => {
              const bx = x(hour) ?? 0;
              const bw = x.bandwidth();
              const fullHeight = innerHeight - y(value);
              const isPeak = hour === peakHour && value > 0;
              const barHeight = mounted ? fullHeight : 0;
              const barY = innerHeight - barHeight;

              return (
                <g key={hour} onMouseEnter={() => setHovered(hour)} onMouseLeave={() => setHovered((h) => (h === hour ? null : h))}>
                  <rect x={bx} y={0} width={bw} height={innerHeight} fill="transparent" className="cursor-pointer" />
                  <rect
                    x={bx}
                    y={barY}
                    width={bw}
                    height={barHeight}
                    rx={3}
                    fill="var(--color-brand-500)"
                    className="transition-colors duration-fast hover:fill-brand-600"
                    style={{ transition: `height 480ms cubic-bezier(.22,1,.36,1) ${hour * 10}ms, y 480ms cubic-bezier(.22,1,.36,1) ${hour * 10}ms` }}
                  />
                  {isPeak && (
                    <text
                      x={bx + bw / 2}
                      y={barY - 8}
                      textAnchor="middle"
                      className="fill-brand-700 text-[10px] font-semibold"
                      style={{ opacity: mounted ? 1 : 0, transition: `opacity 300ms ease ${hour * 10 + 350}ms` }}
                    >
                      {formatCOP(value)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="mt-1 flex gap-[3px] text-[11px] text-text-secondary">
        {buckets.map((_, hour) => (
          <span key={hour} className="flex-1 text-center">
            {hourLabel(hour)}
          </span>
        ))}
      </div>
    </div>
  );
}
