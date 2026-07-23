import { createFileRoute } from '@tanstack/react-router';
import { Printer } from 'lucide-react';
import { useClosingReport, useOrdersByFilter } from '@/lib/queries';
import { reprintClosingReport } from '@/lib/api';
import { formatCOP } from '@/lib/format';
import { formatDateLong } from '@/lib/date';
import { HourlySalesChart } from '@/components/dashboard/HourlySalesChart';
import { useToastStore } from '@/store/useToastStore';

export const Route = createFileRoute('/dashboard/closing-reports/$id')({
  component: ClosingReportPage,
});

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'danger' }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className={`mt-1 text-xl font-bold ${tone === 'danger' ? 'text-danger' : 'text-brand-700'}`}>{value}</p>
    </div>
  );
}

function ClosingReportPage() {
  const { id } = Route.useParams();
  const reportId = Number(id);
  const { data: report, isLoading } = useClosingReport(reportId);
  const { data: orders = [] } = useOrdersByFilter({ date: report?.date, status: 'COMPLETED' });
  const pushToast = useToastStore((s) => s.push);

  const handleReprint = async () => {
    try {
      await reprintClosingReport(reportId);
      pushToast('Reimpresión enviada');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo reimprimir', 'error');
    }
  };

  if (isLoading || !report) return <p className="p-6 text-sm text-text-secondary">Cargando...</p>;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold capitalize text-text-primary">Cierre del {formatDateLong(report.date)}</h1>
        <button
          type="button"
          onClick={handleReprint}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
        >
          <Printer size={15} /> Imprimir de nuevo
        </button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="Ventas totales" value={formatCOP(report.totalSales)} />
        <StatCard label="Órdenes" value={String(report.orderCount)} />
        <StatCard label="Domicilio" value={formatCOP(report.deliverySales)} />
        <StatCard label="Mesa / para llevar" value={formatCOP(report.dineInTakeawaySales)} />
        <StatCard label="Efectivo" value={formatCOP(report.cashSales)} />
        <StatCard label="Tarjeta" value={formatCOP(report.cardSales)} />
        <StatCard label="Transferencia" value={formatCOP(report.transferSales)} />
        <StatCard label="Gastos totales" value={formatCOP(report.totalExpenses)} tone="danger" />
      </div>

      <HourlySalesChart orders={orders} />
    </div>
  );
}
