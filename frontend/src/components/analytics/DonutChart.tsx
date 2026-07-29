interface DonutSegment {
  label: string;
  value: number;
  /** A CSS color value, e.g. 'var(--color-brand-500)' or 'var(--color-success)'. */
  color: string;
  displayValue: string;
}

interface DonutChartProps {
  title?: string;
  segments: DonutSegment[];
}

/** CSS conic-gradient donut + legend - no charting library, matches the app's "simple, no gradients-as-decoration" constraint (this gradient is functional, not decorative). */
export function DonutChart({ title, segments }: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  let cursor = 0;
  const stops = segments.map((s) => {
    const start = total > 0 ? (cursor / total) * 360 : 0;
    cursor += s.value;
    const end = total > 0 ? (cursor / total) * 360 : 0;
    return `${s.color} ${start}deg ${end}deg`;
  });
  const gradient = total > 0 ? `conic-gradient(${stops.join(', ')})` : 'conic-gradient(var(--color-border) 0deg 360deg)';

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      {title && <h3 className="mb-3 text-sm font-semibold text-text-secondary">{title}</h3>}
      <div className="flex items-center gap-4">
        <div className="relative h-20 w-20 shrink-0 rounded-full" style={{ background: gradient }}>
          <div className="absolute inset-[7px] rounded-full bg-surface" />
        </div>
        <div className="flex flex-col gap-1.5">
          {segments.map((s) => (
            <div key={s.label} className="flex items-center gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
              <span className="text-text-secondary">{s.label}</span>
              <span className="font-medium text-text-primary">{s.displayValue}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
