import type { AnalyticsRange } from '@/types/api';

const OPTIONS: { value: AnalyticsRange; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'week', label: 'Últimos 7 días' },
  { value: 'month', label: 'Últimos 30 días' },
  { value: 'custom', label: 'Personalizado' },
];

interface RangeSwitcherProps {
  range: AnalyticsRange;
  onRangeChange: (range: AnalyticsRange) => void;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

export function RangeSwitcher({ range, onRangeChange, from, to, onFromChange, onToChange }: RangeSwitcherProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-surface p-1">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onRangeChange(opt.value)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-fast ${
              range === opt.value ? 'bg-brand-500 text-text-inverted' : 'text-text-secondary hover:text-brand-600'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {range === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onFromChange(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary"
          />
          <span className="text-xs text-text-secondary">a</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onToChange(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary"
          />
        </div>
      )}
    </div>
  );
}
