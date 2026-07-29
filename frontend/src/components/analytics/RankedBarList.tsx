interface RankedBarListItem {
  label: string;
  value: number;
  displayValue: string;
}

interface RankedBarListProps {
  title?: string;
  items: RankedBarListItem[];
  emptyMessage?: string;
}

/** Horizontal bar ranking - reused for top products, categories, employees, and order-type breakdowns. */
export function RankedBarList({ title, items, emptyMessage = 'Sin datos en este periodo.' }: RankedBarListProps) {
  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      {title && <h3 className="mb-3 text-sm font-semibold text-text-secondary">{title}</h3>}
      {items.length === 0 ? (
        <p className="text-sm text-text-secondary">{emptyMessage}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.map((item, i) => (
            <div key={`${item.label}-${i}`} className="flex items-center gap-2.5">
              <span className="w-28 shrink-0 truncate text-xs text-text-secondary" title={item.label}>
                {item.label}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${(item.value / max) * 100}%` }} />
              </div>
              <span className="w-20 shrink-0 text-right text-xs font-medium text-text-primary">{item.displayValue}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
