import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { line as d3line, area as d3area, curveMonotoneX } from 'd3-shape';
import { max as d3max } from 'd3-array';
import { formatCOP } from '@/lib/format';
import { useMeasuredWidth } from './useMeasuredWidth';

const HEIGHT = 260;
const MARGIN = { top: 16, right: 8, bottom: 22, left: 8 };

interface TrendPoint {
  label: string;
  value: number;
}

interface TrendChartProps {
  points: TrendPoint[];
  title?: string;
}

/**
 * D3 (d3-scale/d3-shape) computes the smooth curve and area paths against
 * the container's actual measured width (see useMeasuredWidth - the viewBox
 * exactly matches the rendered box, so the chart fills its card instead of
 * being aspect-fit/letterboxed into it). React owns the DOM and every
 * animation is a plain CSS transition - the line draws in via
 * stroke-dashoffset, then each point pops in with a staggered spring-ish delay.
 */
export function TrendChart({ points, title = 'Tendencia de ventas' }: TrendChartProps) {
  const { ref: containerRef, width: measuredWidth } = useMeasuredWidth<HTMLDivElement>();
  const width = measuredWidth || 600;

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const [pathLength, setPathLength] = useState(0);
  const [drawn, setDrawn] = useState(false);
  const [dotsIn, setDotsIn] = useState(false);

  const innerWidth = width - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  const x = scaleLinear()
    .domain([0, Math.max(points.length - 1, 1)])
    .range([0, innerWidth]);
  const maxValue = Math.max(d3max(points, (p) => p.value) ?? 0, 1);
  const y = scaleLinear()
    .domain([0, maxValue * 1.15])
    .range([innerHeight, 0]);

  const lineGen = d3line<TrendPoint>()
    .x((_, i) => x(i))
    .y((p) => y(p.value))
    .curve(curveMonotoneX);
  const areaGen = d3area<TrendPoint>()
    .x((_, i) => x(i))
    .y0(innerHeight)
    .y1((p) => y(p.value))
    .curve(curveMonotoneX);

  const linePath = lineGen(points) ?? '';
  const areaPath = areaGen(points) ?? '';

  const dataKey = `${width}:${points.map((p) => p.value).join(',')}`;

  useLayoutEffect(() => {
    if (pathRef.current) setPathLength(pathRef.current.getTotalLength());
    setDrawn(false);
    setDotsIn(false);
  }, [dataKey]);

  useEffect(() => {
    const id1 = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    const id2 = setTimeout(() => setDotsIn(true), 550);
    return () => {
      cancelAnimationFrame(id1);
      clearTimeout(id2);
    };
  }, [dataKey, pathLength]);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * width - MARGIN.left;
    const step = innerWidth / Math.max(points.length - 1, 1);
    const idx = Math.min(points.length - 1, Math.max(0, Math.round(relX / step)));
    setHoverIndex(idx);
  };

  const gradId = 'trend-grad';

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold text-text-secondary">{title}</h3>
      <div ref={containerRef} className="relative w-full" style={{ height: HEIGHT }}>
        <svg
          viewBox={`0 0 ${width} ${HEIGHT}`}
          width={width}
          height={HEIGHT}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand-400)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-brand-400)" stopOpacity="0" />
            </linearGradient>
          </defs>

          <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
            <path d={areaPath} fill={`url(#${gradId})`} style={{ opacity: drawn ? 1 : 0, transition: 'opacity 700ms ease 150ms' }} />

            <path
              ref={pathRef}
              d={linePath}
              fill="none"
              stroke="var(--color-brand-500)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: pathLength || 1,
                strokeDashoffset: drawn ? 0 : pathLength || 1,
                transition: 'stroke-dashoffset 900ms cubic-bezier(.22,1,.36,1)',
              }}
            />

            {points.map((p, i) => {
              const isHovered = hoverIndex === i;
              const restingR = p.value > 0 ? 3 : 0;
              const r = isHovered ? 5 : restingR;
              return (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(p.value)}
                  r={dotsIn ? r : 0}
                  fill="var(--color-brand-500)"
                  stroke="var(--color-surface)"
                  strokeWidth={1.5}
                  className="cursor-pointer"
                  style={{ transition: `r 260ms cubic-bezier(.34,1.56,.64,1) ${i * 35}ms` }}
                  onMouseEnter={() => setHoverIndex(i)}
                />
              );
            })}
          </g>
        </svg>

        {hoverIndex != null && points[hoverIndex] && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg bg-text-primary px-2 py-1 text-xs font-medium text-bg shadow-md"
            style={{
              left: `${x(hoverIndex) + MARGIN.left}px`,
              top: `${y(points[hoverIndex].value) + MARGIN.top}px`,
            }}
          >
            {points[hoverIndex].label}: {formatCOP(points[hoverIndex].value)}
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-text-secondary">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}
