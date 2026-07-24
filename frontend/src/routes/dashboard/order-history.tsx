import { useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCurrentCashFlow, useOrdersByFilter, useClosingReports } from '@/lib/queries';
import { closeDay } from '@/lib/api';
import { shiftDate, formatDateLong } from '@/lib/date';
import { Calendar } from '@/components/common/Calendar';
import { OrderHistoryCard } from '@/components/order/OrderHistoryCard';
import { useToastStore } from '@/store/useToastStore';
import type { OrderType } from '@/types/api';
import classNames from 'classnames';

export const Route = createFileRoute('/dashboard/order-history')({
  component: OrderHistoryPage,
});

const categories: { value: OrderType | 'all'; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'dine_in', label: 'Mesa' },
  { value: 'takeaway', label: 'Para llevar' },
  { value: 'delivery', label: 'Domicilio' },
];

function OrderHistoryPage() {
  const { data: current } = useCurrentCashFlow();
  // Wait for the backend's Bogotá business day instead of seeding "today" from the
  // browser's raw UTC date, which can be a day ahead/behind (see caja.tsx).
  if (!current) return <p className="p-6 text-sm text-text-secondary">Cargando...</p>;
  return <OrderHistoryContent today={current.date} />;
}

function OrderHistoryContent({ today }: { today: string }) {
  const [selectedDate, setSelectedDate] = useState(today);
  const [category, setCategory] = useState<OrderType | 'all'>('all');
  const [generating, setGenerating] = useState(false);

  const { data: orders = [], isLoading } = useOrdersByFilter({
    date: selectedDate,
    orderType: category === 'all' ? undefined : category,
  });
  // Unfiltered, just to gate "Generar cierre del día" - the category filter above
  // shouldn't make the button disappear/disable just because e.g. "Domicilio" is
  // empty while the day still has dine_in orders.
  const { data: ordersToday = [] } = useOrdersByFilter({ date: selectedDate });
  const { data: closingReports = [] } = useClosingReports();
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();

  const isToday = selectedDate === today;
  const reportForDate = useMemo(
    () => closingReports.filter((r) => r.date === selectedDate).sort((a, b) => b.id - a.id)[0],
    [closingReports, selectedDate],
  );

  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      const report = await closeDay();
      pushToast('Cierre generado');
      navigate({ to: '/dashboard/closing-reports/$id', params: { id: String(report.id) } });
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo generar el cierre', 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold text-text-primary">Historial de órdenes</h1>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSelectedDate(today)}
              className="rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
            >
              Hoy
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(shiftDate(today, -1))}
              className="rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
            >
              Ayer
            </button>
          </div>
          <Calendar selectedDate={selectedDate} onSelectDate={setSelectedDate} maxDate={today} />
        </div>

        <div className="min-w-64 flex-1">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col">
              <h2 className="font-semibold capitalize text-text-primary">{formatDateLong(selectedDate)}</h2>
              <div className="mt-1 flex gap-1">
                {categories.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={classNames(
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors duration-fast',
                      category === c.value ? 'bg-brand-500 text-white' : 'bg-brand-500/10 text-text-secondary hover:text-brand-600',
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {isToday ? (
              <button
                type="button"
                onClick={handleGenerateReport}
                disabled={generating || ordersToday.length === 0}
                title={ordersToday.length === 0 ? 'No hay órdenes hoy todavía' : undefined}
                className="rounded-full bg-success px-4 py-2 text-sm font-semibold text-white transition-opacity duration-fast hover:opacity-90 disabled:opacity-60"
              >
                {generating ? 'Generando...' : 'Generar cierre del día'}
              </button>
            ) : (
              reportForDate && (
                <button
                  type="button"
                  onClick={() => navigate({ to: '/dashboard/closing-reports/$id', params: { id: String(reportForDate.id) } })}
                  className="rounded-full border border-brand-400 px-4 py-2 text-sm font-semibold text-brand-600 transition-colors duration-fast hover:bg-brand-500/10"
                >
                  Ver cierre del día
                </button>
              )
            )}
          </div>

          <div className="flex flex-col gap-3">
            {isLoading && <p className="text-sm text-text-secondary">Cargando órdenes...</p>}
            {!isLoading && orders.length === 0 && <p className="text-sm text-text-secondary">No hay órdenes para este día.</p>}
            {orders.map((order) => (
              <OrderHistoryCard key={order.id} order={order} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
