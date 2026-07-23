import { createFileRoute, Link } from '@tanstack/react-router';
import { useClosingReports } from '@/lib/queries';
import { formatCOP } from '@/lib/format';
import { formatDateLong } from '@/lib/date';

export const Route = createFileRoute('/dashboard/closing-reports/')({
  component: ClosingReportsPage,
});

function ClosingReportsPage() {
  const { data: reports = [], isLoading } = useClosingReports();
  const sorted = [...reports].sort((a, b) => b.id - a.id);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-text-primary">Cierres del día</h1>

      {isLoading && <p className="text-sm text-text-secondary">Cargando...</p>}
      {!isLoading && sorted.length === 0 && <p className="text-sm text-text-secondary">Todavía no se ha generado ningún cierre.</p>}

      <div className="flex flex-col gap-3">
        {sorted.map((report) => (
          <Link
            key={report.id}
            to="/dashboard/closing-reports/$id"
            params={{ id: String(report.id) }}
            className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-4 transition-colors duration-fast hover:border-brand-400"
          >
            <div>
              <p className="font-semibold capitalize text-text-primary">{formatDateLong(report.date)}</p>
              <p className="text-sm text-text-secondary">{report.orderCount === 1 ? '1 orden' : `${report.orderCount} órdenes`}</p>
            </div>
            <span className="text-lg font-semibold text-brand-700">{formatCOP(report.totalSales)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
