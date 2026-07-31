import { Info, TrendingUp, TrendingDown } from 'lucide-react';

interface KpiCardProps {
  label: string;
  value: string;
  /** null (no prior baseline) hides the delta instead of showing a misleading 0%/∞. */
  growthPct?: number | null;
  tooltip?: string;
  size?: 'hero' | 'default';
}

/** Not a refactor of closing-reports/$id.tsx's StatCard - that page was already shipped/verified, this is analytics-specific (adds the growth delta). */
export function KpiCard({ label, value, growthPct, tooltip, size = 'default' }: KpiCardProps) {
  const showDelta = growthPct != null;
  const isUp = (growthPct ?? 0) >= 0;

  return (
    <div className={`rounded-2xl border border-border bg-surface ${size === 'hero' ? 'p-5' : 'p-4'}`}>
      <p className="flex items-center gap-1 text-sm text-text-secondary">
        {label}
        {tooltip && (
          <span title={tooltip} className="cursor-help">
            <Info size={13} className="shrink-0" />
          </span>
        )}
      </p>
      <p className={`mt-1 font-bold text-brand-700 ${size === 'hero' ? 'text-3xl' : 'text-xl'}`}>{value}</p>
      {showDelta && (
        <p className={`mt-1 flex flex-wrap items-center gap-1 text-xs font-semibold ${isUp ? 'text-success' : 'text-danger'}`}>
          {isUp ? <TrendingUp size={12} className="shrink-0" /> : <TrendingDown size={12} className="shrink-0" />}
          {Math.abs(growthPct as number).toFixed(1)}% vs. periodo anterior
        </p>
      )}
    </div>
  );
}
