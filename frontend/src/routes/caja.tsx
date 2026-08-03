import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { mutate } from 'swr';
import { Info, Settings } from 'lucide-react';
import { useCashFlowExpenses, useCashFlowHistory, useCashFlowSettings, useCurrentCashFlow } from '@/lib/queries';
import { addCashExpense, updateCurrentCash } from '@/lib/api';
import { formatCOP } from '@/lib/format';
import { formatDateLong, formatTime } from '@/lib/date';
import { Calendar } from '@/components/common/Calendar';
import { CashSettingsModal } from '@/components/dashboard/CashSettingsModal';
import { useSessionStore } from '@/store/useSessionStore';
import { useToastStore } from '@/store/useToastStore';
import type { CashFlowDay } from '@/types/api';

export const Route = createFileRoute('/caja')({
  component: CajaPage,
});

function CajaPage() {
  const { data: current } = useCurrentCashFlow();
  // Waiting for `current` lets the inner component safely seed selectedDate from the
  // backend's Bogotá business day instead of the browser's raw (possibly off-by-one) UTC date.
  if (!current) return <p className="p-6 text-sm text-text-secondary">Cargando...</p>;
  return <CajaContent current={current} />;
}

interface SparklinePoint {
  x: number;
  y: number;
}

const SPARKLINE_WIDTH = 140;
const SPARKLINE_HEIGHT = 40;
const SPARKLINE_PAD = 4;

function buildSparklinePoints(values: number[]): SparklinePoint[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = SPARKLINE_WIDTH / (values.length - 1);
  return values.map((v, i) => ({
    x: i * step,
    y: SPARKLINE_PAD + ((max - v) / range) * (SPARKLINE_HEIGHT - SPARKLINE_PAD * 2),
  }));
}

function CajaContent({ current }: { current: CashFlowDay }) {
  const isAdmin = useSessionStore((s) => s.employee?.role === 'admin');
  // Default opening cash is admin-only to see or change (see routes/cashFlow.ts) -
  // skip the request entirely for non-admins instead of hitting a 401.
  const { data: settings } = useCashFlowSettings(isAdmin);
  const { data: history = [] } = useCashFlowHistory();
  const pushToast = useToastStore((s) => s.push);

  const [selectedDate, setSelectedDate] = useState(current.date);
  const [cashInput, setCashInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [justification, setJustification] = useState('');
  const [submittingExpense, setSubmittingExpense] = useState(false);

  const historyByDate = useMemo(() => new Map(history.map((h) => [h.date, h])), [history]);
  const highlightedDates = useMemo(() => new Set(history.map((h) => h.date)), [history]);
  const selectedPeriod = historyByDate.get(selectedDate);
  const isToday = selectedDate === current.date;

  const { data: expenses = [] } = useCashFlowExpenses(selectedPeriod?.id ?? null);
  // Independent of the selected day so the "Gastos de hoy" KPI stays fixed to today even
  // while browsing the calendar - SWR dedupes this against the call above when they match.
  const { data: todayExpenses = [] } = useCashFlowExpenses(current.id);

  const last7 = useMemo(() => history.slice(0, 7).slice().reverse(), [history]);
  const sparklinePoints = last7.length > 1 ? buildSparklinePoints(last7.map((h) => h.cashInRegister)) : null;
  const sparklineAverage = last7.length > 0 ? Math.round(last7.reduce((sum, h) => sum + h.cashInRegister, 0) / last7.length) : null;

  const openingDelta = settings ? current.cashInRegister - settings.defaultOpeningCash : null;

  const handleSaveCash = async () => {
    if (cashInput === '') return;
    try {
      const updated = await updateCurrentCash(Number(cashInput) || 0);
      await mutate('/cash-flow/current', updated, { revalidate: false });
      await mutate('/cash-flow');
      pushToast('Efectivo en caja actualizado');
      setCashInput('');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo actualizar', 'error');
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!justification.trim()) {
      pushToast('La justificación es obligatoria', 'warning');
      return;
    }
    setSubmittingExpense(true);
    try {
      await addCashExpense(Number(expenseAmount) || 0, justification.trim());
      await mutate('/cash-flow/current');
      await mutate('/cash-flow');
      await mutate(`/cash-flow/${current.id}/expenses`);
      setExpenseAmount('');
      setJustification('');
      pushToast('Gasto registrado');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'No se pudo registrar el gasto', 'error');
    } finally {
      setSubmittingExpense(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text-primary">Caja</h1>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
          >
            <Settings size={16} /> Efectivo inicial por defecto ({settings ? formatCOP(settings.defaultOpeningCash) : '—'})
          </button>
        )}
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2 rounded-2xl border border-brand-300 bg-brand-500/10 p-4">
          <span className="flex items-center gap-1 text-sm text-text-secondary">
            Efectivo final en caja
            <span
              title="Base de caja de hoy + ventas en efectivo de hoy. Es el efectivo que debería haber físicamente en la caja en este momento."
              className="cursor-help"
            >
              <Info size={13} className="shrink-0" />
            </span>
          </span>
          <span className="text-2xl font-bold text-brand-700">{formatCOP(current.cashInRegister + (current.cashSalesToday ?? 0))}</span>
          <span className="text-sm text-text-secondary">
            Base {formatCOP(current.cashInRegister)} + ventas en efectivo {formatCOP(current.cashSalesToday ?? 0)}
          </span>
          {openingDelta !== null && (
            <span className={`text-sm font-medium ${openingDelta >= 0 ? 'text-success' : 'text-danger'}`}>
              {openingDelta >= 0 ? '+' : ''}
              {formatCOP(openingDelta)} vs. apertura por defecto
            </span>
          )}
          <div className="mt-1 flex gap-2">
            <input
              type="number"
              min={0}
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              placeholder="Nueva base"
              className="w-32 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-400"
            />
            <button
              type="button"
              onClick={handleSaveCash}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600"
            >
              Guardar
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
          <span className="text-sm text-text-secondary">Gastos de hoy</span>
          <span className="text-2xl font-bold text-danger">{formatCOP(current.expenses)}</span>
          <span className="text-sm text-text-secondary">
            {todayExpenses.length} gasto{todayExpenses.length === 1 ? '' : 's'} registrado{todayExpenses.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
          <span className="text-sm text-text-secondary">
            Últimos {last7.length || 7} día{(last7.length || 7) === 1 ? '' : 's'}
          </span>
          {sparklinePoints ? (
            <>
              <svg viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`} width="100%" height={SPARKLINE_HEIGHT} preserveAspectRatio="none" className="mt-1">
                <polyline
                  points={sparklinePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="var(--color-brand-400)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx={sparklinePoints[sparklinePoints.length - 1].x} cy={sparklinePoints[sparklinePoints.length - 1].y} r={3} fill="var(--color-brand-500)" />
              </svg>
              <span className="text-sm text-text-secondary">Promedio {formatCOP(sparklineAverage ?? 0)}</span>
            </>
          ) : (
            <span className="text-sm text-text-secondary">Necesitamos más días para mostrar la tendencia.</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <Calendar selectedDate={selectedDate} onSelectDate={setSelectedDate} highlightedDates={highlightedDates} maxDate={current.date} />

        <div className="min-w-64 flex-1 rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold text-text-primary">Gastos del {formatDateLong(selectedDate)}</h2>

          {!selectedPeriod ? (
            <p className="text-sm text-text-secondary">No hay un periodo de caja registrado ese día.</p>
          ) : (
            <>
              <ul className="mb-4 flex flex-col divide-y divide-border">
                {expenses.length === 0 && <li className="py-2 text-sm text-text-secondary">Sin gastos registrados.</li>}
                {expenses.map((expense) => (
                  <li key={expense.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="w-20 shrink-0 whitespace-nowrap text-xs text-text-secondary">{formatTime(expense.createdAt)}</span>
                    <span className="flex-1 text-text-primary">{expense.justification}</span>
                    <span className="font-medium text-danger">{formatCOP(expense.amount)}</span>
                  </li>
                ))}
              </ul>

              {isToday && (
                <form onSubmit={handleAddExpense} className="flex flex-col gap-2 border-t border-border pt-3">
                  <p className="text-sm font-medium text-text-primary">Registrar gasto</p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="number"
                      min={0}
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
                      placeholder="Monto"
                      className="w-32 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-400"
                    />
                    <input
                      type="text"
                      value={justification}
                      onChange={(e) => setJustification(e.target.value)}
                      placeholder="Justificación"
                      className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-text-primary outline-none focus:border-brand-400"
                    />
                    <button
                      type="submit"
                      disabled={submittingExpense}
                      className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white transition-colors duration-fast hover:bg-brand-600 disabled:opacity-60"
                    >
                      Agregar
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      <CashSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} currentDefault={settings?.defaultOpeningCash ?? 0} />
    </div>
  );
}
