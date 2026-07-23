import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { mutate } from 'swr';
import { Settings } from 'lucide-react';
import { useCashFlowExpenses, useCashFlowHistory, useCashFlowSettings, useCurrentCashFlow } from '@/lib/queries';
import { addCashExpense, updateCurrentCash } from '@/lib/api';
import { formatCOP } from '@/lib/format';
import { Calendar } from '@/components/common/Calendar';
import { CashSettingsModal } from '@/components/dashboard/CashSettingsModal';
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

function CajaContent({ current }: { current: CashFlowDay }) {
  const { data: settings } = useCashFlowSettings();
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
      <h1 className="mb-4 text-xl font-semibold text-text-primary">Caja</h1>

      <div className="mb-6 flex flex-wrap gap-4">
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
          <span className="text-sm text-text-secondary">Efectivo en caja hoy</span>
          <span className="text-2xl font-bold text-brand-700">{formatCOP(current.cashInRegister)}</span>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={cashInput}
              onChange={(e) => setCashInput(e.target.value)}
              placeholder="Nuevo monto"
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

        <div className="flex flex-col justify-between gap-2 rounded-2xl border border-border bg-surface p-4">
          <span className="text-sm text-text-secondary">Gastos de hoy</span>
          <span className="text-2xl font-bold text-danger">{formatCOP(current.expenses)}</span>
        </div>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex items-center gap-2 self-start rounded-2xl border border-border bg-surface px-4 py-3 text-sm font-medium text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600"
        >
          <Settings size={16} /> Efectivo inicial por defecto ({settings ? formatCOP(settings.defaultOpeningCash) : '—'})
        </button>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <Calendar selectedDate={selectedDate} onSelectDate={setSelectedDate} highlightedDates={highlightedDates} />

        <div className="min-w-64 flex-1 rounded-2xl border border-border bg-surface p-4">
          <h2 className="mb-3 font-semibold text-text-primary">Gastos del {selectedDate}</h2>

          {!selectedPeriod ? (
            <p className="text-sm text-text-secondary">No hay un periodo de caja registrado ese día.</p>
          ) : (
            <>
              <ul className="mb-4 flex flex-col divide-y divide-border">
                {expenses.length === 0 && <li className="py-2 text-sm text-text-secondary">Sin gastos registrados.</li>}
                {expenses.map((expense) => (
                  <li key={expense.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-text-primary">{expense.justification}</span>
                    <span className="font-medium text-danger">{formatCOP(expense.amount)}</span>
                  </li>
                ))}
              </ul>

              {isToday && (
                <form onSubmit={handleAddExpense} className="flex flex-col gap-2 border-t border-border pt-3">
                  <p className="text-sm font-medium text-text-primary">Registrar gasto</p>
                  <div className="flex gap-2">
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
