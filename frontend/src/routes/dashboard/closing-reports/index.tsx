import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Printer, Info } from 'lucide-react';
import { useClosingReports, useClosingReport, useCurrentCashFlow, useOrdersByFilter } from '@/lib/queries';
import { reprintClosingReport } from '@/lib/api';
import { formatCOP } from '@/lib/format';
import { formatMonthLong, formatDateLong, shiftMonth } from '@/lib/date';
import { HourlyBars } from '@/components/charts/HourlyBars';
import { useDebouncedCallback } from '@/lib/useDebouncedCallback';
import { useSessionStore } from '@/store/useSessionStore';
import { useToastStore } from '@/store/useToastStore';
import type { ClosingReport } from '@/types/api';

interface ClosingReportsSearch {
  /** Set by order-history's "Ver cierre del día"/"Generar cierre del día" to open a specific report directly instead of defaulting to the most recent one. There's no separate route per report anymore - this page shows every report's detail inline. */
  reportId?: number;
}

export const Route = createFileRoute('/dashboard/closing-reports/')({
  validateSearch: (search: Record<string, unknown>): ClosingReportsSearch => ({
    reportId: typeof search.reportId === 'string' || typeof search.reportId === 'number' ? Number(search.reportId) : undefined,
  }),
  // Open to any employee (see routes/endOfDay.ts) - staff may need to check
  // the day's numbers while closing, not just admins. Reprinting a report
  // still checks isAdmin itself further down, since that's a
  // physical-document action, not just viewing.
  component: ClosingReportsPage,
});

const DOW_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

function daysInMonth(monthStr: string): number {
  const [year, month] = monthStr.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Monday .. 6 = Sunday, so the grid always starts the week on Monday. */
function firstDowMondayIndex(monthStr: string): number {
  const [year, month] = monthStr.split('-').map(Number);
  const jsDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return (jsDay + 6) % 7;
}

function ClosingReportsPage() {
  const { data: current } = useCurrentCashFlow();
  // Wait for the backend's Bogotá business day instead of seeding "today"
  // from the browser's raw UTC date, which can be a day ahead/behind (see
  // order-history/index.tsx and caja.tsx, which already do this).
  if (!current) return <p className="p-4 text-sm text-text-secondary sm:p-6">Cargando...</p>;
  return <ClosingReportsContent today={current.date} />;
}

function ClosingReportsContent({ today }: { today: string }) {
  const { reportId } = Route.useSearch();
  const { data: reports = [], isLoading } = useClosingReports();
  // Chronological order (not id order - a same-day reprint/re-close wouldn't
  // otherwise line up with its neighbors) so the day arrows in the detail
  // panel step through actual days, like flipping pages in a ledger. Ties
  // (two reports for the same date) break by id descending, newest first -
  // without an explicit tie case a comparator that only ever returns 1/-1
  // never tells the sort two dates are equal, which made same-day ordering
  // non-deterministic instead of consistently "newest wins".
  const sortedByDate = useMemo(
    () => [...reports].sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1)),
    [reports]
  );

  // Everything lives on this one page - selecting a day swaps which report's
  // detail shows below/beside the calendar instead of navigating to a
  // separate route per report. reportId (from order-history's deep link)
  // wins on first load; once the admin clicks around, their own pick takes over.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const activeId = selectedId ?? reportId ?? sortedByDate[0]?.id ?? null;
  const activeReport = reports.find((r) => r.id === activeId);

  const [viewMonth, setViewMonth] = useState<string | null>(null);
  const effectiveMonth = viewMonth ?? activeReport?.date.slice(0, 7) ?? sortedByDate[0]?.date.slice(0, 7) ?? today.slice(0, 7);

  // A date can have more than one report (closing the day again is
  // explicitly supported - see endOfDayService.closeDay, history is never
  // lost). The calendar shows the most recent one per day, so build the map
  // in ascending-id order - each later (more recent) report for a date
  // overwrites the earlier one instead of the other way around.
  const byDate = useMemo(() => {
    const map = new Map<string, ClosingReport>();
    for (const r of [...reports].sort((a, b) => a.id - b.id)) {
      map.set(r.date, r);
    }
    return map;
  }, [reports]);
  // Derived from byDate (already deduped to the latest report per date), not
  // raw `reports` - an old superseded same-day report shouldn't skew the
  // month's max and throw off every cell's color intensity.
  const monthReports = [...byDate.values()].filter((r) => r.date.startsWith(effectiveMonth));
  const monthMax = Math.max(...monthReports.map((r) => r.totalSales), 1);

  const leadingBlanks = firstDowMondayIndex(effectiveMonth);
  const cells: (string | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth(effectiveMonth) }, (_, i) => `${effectiveMonth}-${String(i + 1).padStart(2, '0')}`),
  ];

  return (
    <div className="p-4 sm:p-6">
      <h1 className="mb-4 text-xl font-semibold text-text-primary">Cierres del día</h1>

      {isLoading && <p className="text-sm text-text-secondary">Cargando...</p>}
      {!isLoading && reports.length === 0 && <p className="text-sm text-text-secondary">Todavía no se ha generado ningún cierre.</p>}

      {!isLoading && reports.length > 0 && (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="w-full shrink-0 lg:w-72">
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setViewMonth(shiftMonth(effectiveMonth, -1))}
                aria-label="Mes anterior"
                className="rounded-lg p-1.5 text-text-secondary hover:bg-brand-500/10 hover:text-brand-600"
              >
                <ChevronLeft size={18} />
              </button>
              <p className="text-sm font-semibold capitalize text-text-primary">{formatMonthLong(effectiveMonth)}</p>
              <button
                type="button"
                onClick={() => setViewMonth(shiftMonth(effectiveMonth, 1))}
                aria-label="Mes siguiente"
                className="rounded-lg p-1.5 text-text-secondary hover:bg-brand-500/10 hover:text-brand-600"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs text-text-secondary">
              {DOW_LABELS.map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((date, i) => {
                const report = date ? byDate.get(date) : undefined;
                const dayNum = date ? Number(date.slice(-2)) : null;
                const isToday = date === today;

                if (!report) {
                  return (
                    <div
                      key={i}
                      className={`flex aspect-square flex-col items-center justify-center rounded-lg text-xs text-text-secondary ${
                        isToday ? 'ring-1 ring-inset ring-brand-300' : ''
                      }`}
                    >
                      {dayNum ?? ''}
                    </div>
                  );
                }

                const intensity = 0.18 + (report.totalSales / monthMax) * 0.72;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setSelectedId(report.id)}
                    className={`flex aspect-square flex-col items-center justify-center rounded-lg text-xs font-semibold text-text-primary transition-transform duration-fast hover:-translate-y-0.5 ${
                      report.id === activeId ? 'ring-2 ring-brand-500' : isToday ? 'ring-1 ring-inset ring-brand-300' : ''
                    }`}
                    style={{ backgroundColor: `rgba(251,109,51,${intensity})` }}
                    title={`${report.orderCount} órdenes · ${formatCOP(report.totalSales)}`}
                  >
                    <span>{dayNum}</span>
                    <span className="text-[9px] font-normal opacity-80">{(report.totalSales / 1_000_000).toFixed(1)}M</span>
                  </button>
                );
              })}
            </div>

            {monthReports.length === 0 && <p className="mt-4 text-sm text-text-secondary">Sin cierres este mes.</p>}
          </div>

          <div className="min-w-0 flex-1">
            <ReportDetail reportId={activeId} sortedByDate={sortedByDate} onSelect={setSelectedId} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone, tooltip }: { label: string; value: string; tone?: 'danger'; tooltip?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="flex items-center gap-1 text-sm text-text-secondary">
        {label}
        {tooltip && (
          <span title={tooltip} className="cursor-help">
            <Info size={13} className="shrink-0" />
          </span>
        )}
      </p>
      <p className={`mt-1 text-xl font-bold ${tone === 'danger' ? 'text-danger' : 'text-brand-700'}`}>{value}</p>
    </div>
  );
}

function ReportDetail({
  reportId,
  sortedByDate,
  onSelect,
}: {
  reportId: number | null;
  sortedByDate: ClosingReport[];
  onSelect: (id: number) => void;
}) {
  const { data: report, isLoading } = useClosingReport(reportId);
  const { data: orders = [] } = useOrdersByFilter({ date: report?.date, status: 'COMPLETED' });
  const pushToast = useToastStore((s) => s.push);
  // Viewing a closing report is open to any employee (see Route.beforeLoad
  // above), but reprinting stays admin-only server-side (routes/endOfDay.ts)
  // - hide the button for non-admins instead of letting them hit a 403.
  const isAdmin = useSessionStore((s) => s.employee?.role === 'admin');

  const currentIndex = sortedByDate.findIndex((r) => r.id === reportId);
  const previousDay = currentIndex >= 0 ? sortedByDate[currentIndex + 1] : undefined;
  const nextDay = currentIndex > 0 ? sortedByDate[currentIndex - 1] : undefined;

  const handleReprint = useDebouncedCallback(async () => {
    if (!report) return;
    try {
      await reprintClosingReport(report.id);
      pushToast('Reimpresión enviada');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo reimprimir', 'error');
    }
  });

  if (isLoading || !report) return <p className="text-sm text-text-secondary">Selecciona un día en el calendario</p>;

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => previousDay && onSelect(previousDay.id)}
            disabled={!previousDay}
            aria-label="Cierre anterior"
            className="shrink-0 rounded-lg p-1.5 text-text-secondary hover:bg-brand-500/10 hover:text-brand-600 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={18} />
          </button>
          <h1 className="text-xl font-semibold capitalize text-text-primary">Cierre del {formatDateLong(report.date)}</h1>
          <button
            type="button"
            onClick={() => nextDay && onSelect(nextDay.id)}
            disabled={!nextDay}
            aria-label="Cierre siguiente"
            className="shrink-0 rounded-lg p-1.5 text-text-secondary hover:bg-brand-500/10 hover:text-brand-600 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight size={18} />
          </button>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={handleReprint}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600 sm:w-auto"
          >
            <Printer size={15} /> Imprimir de nuevo
          </button>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {/* Overview */}
        <StatCard
          label="Ventas totales"
          value={formatCOP(report.totalSales)}
          tooltip="No incluye propinas (se muestran aparte). Los descuentos ya están restados, así que refleja el dinero real vendido."
        />
        <StatCard label="Órdenes" value={String(report.orderCount)} />
        <StatCard label="Artículos vendidos" value={String(report.itemsSold)} />
        <StatCard label="Propinas" value={formatCOP(report.tips)} />

        {/* Breakdown by order type */}
        <StatCard label="Ventas domicilio" value={formatCOP(report.deliverySales)} />
        <StatCard label="Órdenes domicilio" value={String(report.deliveryOrderCount)} />
        <StatCard label="Ventas mesa / para llevar" value={formatCOP(report.dineInTakeawaySales)} />
        <StatCard label="Órdenes mesa" value={String(report.dineInOrderCount)} />
        <StatCard label="Órdenes para llevar" value={String(report.takeawayOrderCount)} />

        {/* Breakdown by payment method */}
        <StatCard
          label="Ventas en efectivo"
          value={formatCOP(report.cashSales)}
          tooltip="No incluye propinas (se muestran aparte). Los descuentos ya están restados, así que refleja el dinero real vendido en efectivo."
        />
        <StatCard
          label="Efectivo final en caja"
          value={formatCOP(report.cashInRegister + report.cashSales)}
          tooltip="Base de caja del día + ventas en efectivo del día. Es el efectivo que debería haber físicamente en la caja al cierre."
        />
        <StatCard label="Ventas en tarjeta" value={formatCOP(report.cardSales)} />
        <StatCard label="Ventas en transferencia" value={formatCOP(report.transferSales)} />

        {/* Deductions */}
        <StatCard label="Descuentos" value={formatCOP(report.discounts)} tone="danger" />
        <StatCard label="Gastos totales" value={formatCOP(report.totalExpenses)} tone="danger" />
      </div>

      <HourlyBars orders={orders} />
    </>
  );
}
