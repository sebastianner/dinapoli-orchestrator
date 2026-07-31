import { useState } from 'react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useSessionStore } from '@/store/useSessionStore';
import { formatCOP } from '@/lib/format';
import { shiftDate } from '@/lib/date';
import {
  useAnalyticsSummary,
  useSalesTrend,
  useAnalyticsBreakdown,
  useAnalyticsHeatmap,
  useAnalyticsProducts,
  useAnalyticsCustomers,
  useAnalyticsEmployees,
  useAnalyticsPromotions,
} from '@/lib/queries';
import { KpiCard } from '@/components/analytics/KpiCard';
import { TrendChart } from '@/components/charts/TrendChart';
import { RankedBarList } from '@/components/analytics/RankedBarList';
import { DonutChart } from '@/components/analytics/DonutChart';
import { BusyHeatmap } from '@/components/analytics/BusyHeatmap';
import { RangeSwitcher } from '@/components/analytics/RangeSwitcher';
import type { AnalyticsRange } from '@/types/api';

export const Route = createFileRoute('/analytics')({
  beforeLoad: () => {
    // Own top-level section, same admin-only gating convention as /ajustes -
    // this exposes revenue/customer/employee data (see routes/analytics.ts).
    if (useSessionStore.getState().employee?.role !== 'admin') {
      throw redirect({ to: '/tables' });
    }
  },
  component: AnalyticsPage,
});

type TabKey = 'resumen' | 'ventas' | 'productos' | 'clientes' | 'empleados';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'resumen', label: 'Resumen' },
  { key: 'ventas', label: 'Ventas' },
  { key: 'productos', label: 'Productos' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'empleados', label: 'Empleados' },
];

const ORDER_TYPE_LABELS: Record<string, string> = { delivery: 'Domicilio', dine_in: 'Mesa', takeaway: 'Para llevar' };
const PAYMENT_LABELS: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };
const PAYMENT_COLORS: Record<string, string> = {
  cash: 'var(--color-brand-500)',
  card: 'var(--color-success)',
  transfer: 'var(--color-text-secondary)',
};

// Visually distinct (not just brand-shade steps, which read as one flat
// color once 3+ categories share the ring) - reuses existing semantic tokens.
const CATEGORY_COLORS = [
  'var(--color-brand-500)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-brand-800)',
  'var(--color-text-secondary)',
  'var(--color-danger)',
];

function AnalyticsPage() {
  const [tab, setTab] = useState<TabKey>('resumen');
  const [range, setRange] = useState<AnalyticsRange>('today');
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [customFrom, setCustomFrom] = useState(() => shiftDate(new Date().toISOString().slice(0, 10), -7));

  const from = range === 'custom' ? customFrom : undefined;
  const to = range === 'custom' ? customTo : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 sm:px-6">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-fast ${
                tab === t.key ? 'bg-brand-50 text-brand-600' : 'text-text-secondary hover:text-brand-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <RangeSwitcher range={range} onRangeChange={setRange} from={customFrom} to={customTo} onFromChange={setCustomFrom} onToChange={setCustomTo} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {tab === 'resumen' && <ResumenTab range={range} from={from} to={to} />}
        {tab === 'ventas' && <VentasTab range={range} from={from} to={to} />}
        {tab === 'productos' && <ProductosTab range={range} from={from} to={to} />}
        {tab === 'clientes' && <ClientesTab range={range} from={from} to={to} />}
        {tab === 'empleados' && <EmpleadosTab range={range} from={from} to={to} />}
      </div>
    </div>
  );
}

interface TabProps {
  range: AnalyticsRange;
  from?: string;
  to?: string;
}

function ResumenTab({ range, from, to }: TabProps) {
  const { data: summary, isLoading: summaryLoading } = useAnalyticsSummary(range, from, to);
  const { data: trend, isLoading: trendLoading } = useSalesTrend(range, from, to);
  const { data: products, isLoading: productsLoading } = useAnalyticsProducts(range, from, to);

  if (summaryLoading || trendLoading || productsLoading || !summary || !trend || !products) {
    return <p className="text-sm text-text-secondary">Cargando...</p>;
  }

  const topProduct = products.products[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <KpiCard
            label="Ventas totales"
            value={formatCOP(summary.totalSales)}
            growthPct={summary.totalSalesGrowthPct}
            tooltip="No incluye propinas. Los descuentos ya están restados - refleja el dinero real vendido en el periodo."
            size="hero"
          />
        </div>
        <KpiCard label="Órdenes" value={String(summary.orderCount)} growthPct={summary.orderCountGrowthPct} />
        <KpiCard label="Ticket promedio" value={formatCOP(summary.avgOrderValue)} growthPct={summary.avgOrderValueGrowthPct} />
        <KpiCard label="Artículos / orden" value={summary.itemsPerOrder.toFixed(1)} />
        <KpiCard label="Clientes atendidos" value={String(summary.customersServed)} growthPct={summary.customersServedGrowthPct} />
        <div className="sm:col-span-2">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="text-sm text-text-secondary">Producto más vendido</p>
            {topProduct ? (
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-xl font-bold text-brand-700">{topProduct.name}</span>
                <span className="shrink-0 text-sm font-medium text-text-secondary">
                  {formatCOP(topProduct.revenue)} · {topProduct.quantity} uds
                </span>
              </div>
            ) : (
              <p className="mt-1 text-xl font-bold text-text-secondary">Sin datos</p>
            )}
          </div>
        </div>
      </div>
      <TrendChart points={trend.map((p) => ({ label: p.bucketLabel, value: p.totalSales }))} />
    </div>
  );
}

function VentasTab({ range, from, to }: TabProps) {
  const { data: breakdown, isLoading: breakdownLoading } = useAnalyticsBreakdown(range, from, to);
  const { data: heatmap, isLoading: heatmapLoading } = useAnalyticsHeatmap(range, from, to);
  const { data: promos, isLoading: promosLoading } = useAnalyticsPromotions(range, from, to);

  if (breakdownLoading || heatmapLoading || promosLoading || !breakdown || !heatmap || !promos) {
    return <p className="text-sm text-text-secondary">Cargando...</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DonutChart
          title="Métodos de pago"
          segments={breakdown.paymentMethods.map((m) => ({
            label: PAYMENT_LABELS[m.method],
            value: m.sales,
            color: PAYMENT_COLORS[m.method],
            displayValue: formatCOP(m.sales),
          }))}
        />
        <RankedBarList
          title="Tipo de orden"
          items={breakdown.orderTypes.map((t) => ({
            label: `${ORDER_TYPE_LABELS[t.orderType]} (${t.orderCount})`,
            value: t.sales,
            displayValue: formatCOP(t.sales),
          }))}
        />
      </div>
      <BusyHeatmap cells={heatmap} />
      <div className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-text-secondary">
          Descuentos
          <span title="Suma de descuentos otorgados en el periodo y qué porcentaje de órdenes los incluyó." className="cursor-help">
            <Info size={13} className="shrink-0" />
          </span>
        </h3>
        <div className="flex flex-wrap gap-6 text-sm">
          <span className="text-text-primary">
            <b className="text-danger">{formatCOP(promos.totalDiscount)}</b> en descuentos
          </span>
          <span className="text-text-primary">
            <b>{promos.discountedOrderPct.toFixed(0)}%</b> de las órdenes tuvo descuento
          </span>
          {promos.promoCounts.map((p) => (
            <span key={p.promoType} className="text-text-primary">
              <b>{p.orderCount}</b> {p.promoType === 'duo' ? 'órdenes Duo' : 'órdenes Pizza XL'}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProductosTab({ range, from, to }: TabProps) {
  const { data, isLoading } = useAnalyticsProducts(range, from, to);
  if (isLoading || !data) return <p className="text-sm text-text-secondary">Cargando...</p>;

  const byRevenue = [...data.products].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
  const byQuantity = [...data.products].sort((a, b) => b.quantity - a.quantity).slice(0, 8);
  const leastSold = [...data.products].sort((a, b) => a.quantity - b.quantity).slice(0, 5);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RankedBarList
          title="Más vendidos por ingreso"
          items={byRevenue.map((p) => ({ label: p.name, value: p.revenue, displayValue: formatCOP(p.revenue) }))}
        />
        <RankedBarList
          title="Más vendidos por cantidad"
          items={byQuantity.map((p) => ({ label: p.name, value: p.quantity, displayValue: String(p.quantity) }))}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <h3 className="mb-3 flex items-center gap-1 text-sm font-semibold text-text-secondary">
            Menos vendidos
            <span title="Candidatos a rediseñar o retirar del menú." className="cursor-help">
              <Info size={13} className="shrink-0" />
            </span>
          </h3>
          {leastSold.length === 0 ? (
            <p className="text-sm text-text-secondary">Sin datos en este periodo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {leastSold.map((p) => (
                    <tr key={p.name} className="border-b border-border last:border-0">
                      <td className="py-1.5 text-text-primary">{p.name}</td>
                      <td className="py-1.5 text-right text-text-secondary">{p.quantity} uds</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <DonutChart
          title="Ingreso por categoría"
          segments={data.categories.slice(0, 6).map((c, i) => ({
            label: c.category,
            value: c.revenue,
            color: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
            displayValue: formatCOP(c.revenue),
          }))}
        />
      </div>
    </div>
  );
}

function ClientesTab({ range, from, to }: TabProps) {
  const { data, isLoading } = useAnalyticsCustomers(range, from, to);
  if (isLoading || !data) return <p className="text-sm text-text-secondary">Cargando...</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
        <KpiCard label="Clientes nuevos" value={String(data.growth.newCustomers)} />
        <KpiCard label="Clientes recurrentes" value={String(data.growth.returningCustomers)} />
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="mb-3 text-sm font-semibold text-text-secondary">Mejores clientes</h3>
        {data.topCustomers.length === 0 ? (
          <p className="text-sm text-text-secondary">Sin datos en este periodo.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-secondary">
                  <th className="pb-2 font-medium">Cliente</th>
                  <th className="pb-2 font-medium">Órdenes</th>
                  <th className="pb-2 text-right font-medium">Gasto</th>
                </tr>
              </thead>
              <tbody>
                {data.topCustomers.map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <td className="py-2 whitespace-nowrap text-text-primary">
                      {c.name}
                      {c.phone && <span className="ml-1 text-text-secondary">· {c.phone}</span>}
                    </td>
                    <td className="py-2 text-text-secondary">{c.orderCount}</td>
                    <td className="py-2 text-right font-medium text-brand-700">{formatCOP(c.spend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function EmpleadosTab({ range, from, to }: TabProps) {
  const { data, isLoading } = useAnalyticsEmployees(range, from, to);
  if (isLoading || !data) return <p className="text-sm text-text-secondary">Cargando...</p>;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold text-text-secondary">Desempeño por empleado</h3>
      {data.length === 0 ? (
        <p className="text-sm text-text-secondary">Sin datos en este periodo.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-secondary">
                <th className="pb-2 font-medium">Empleado</th>
                <th className="pb-2 font-medium">Órdenes</th>
                <th className="pb-2 text-right font-medium">Ventas</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="py-2 whitespace-nowrap text-text-primary">
                    {e.name}
                    {!e.isActive && <span className="ml-1 text-xs text-text-secondary">(inactivo)</span>}
                  </td>
                  <td className="py-2 text-text-secondary">{e.orderCount}</td>
                  <td className="py-2 text-right font-medium text-brand-700">{formatCOP(e.sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
