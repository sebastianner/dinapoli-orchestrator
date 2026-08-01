import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowDownNarrowWide, ArrowUpNarrowWide, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  useCurrentCashFlow,
  useOrdersByFilter,
  useOrdersPage,
  useClosingReports,
} from "@/lib/queries";
import { closeDay } from "@/lib/api";
import { shiftDate, formatDateLong } from "@/lib/date";
import { Calendar } from "@/components/common/Calendar";
import { OrderHistoryCard } from "@/components/order/OrderHistoryCard";
import { DeleteOrderModal } from "@/components/order/DeleteOrderModal";
import { useSessionStore } from "@/store/useSessionStore";
import { useToastStore } from "@/store/useToastStore";
import type { Order, OrderType } from "@/types/api";
import classNames from "classnames";

export const Route = createFileRoute("/dashboard/order-history/")({
  component: OrderHistoryPage,
});

const categories: { value: OrderType | "all"; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "dine_in", label: "Mesa" },
  { value: "takeaway", label: "Para llevar" },
  { value: "delivery", label: "Domicilio" },
];

const PAGE_SIZE = 10;

function OrderHistoryPage() {
  const { data: current } = useCurrentCashFlow();
  // Wait for the backend's Bogotá business day instead of seeding "today" from the
  // browser's raw UTC date, which can be a day ahead/behind (see caja.tsx).
  if (!current)
    return <p className="p-6 text-sm text-text-secondary">Cargando...</p>;
  return <OrderHistoryContent today={current.date} />;
}

function OrderHistoryContent({ today }: { today: string }) {
  const [selectedDate, setSelectedDate] = useState(today);
  const [category, setCategory] = useState<OrderType | "all">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [generating, setGenerating] = useState(false);
  const [page, setPage] = useState(1);
  const [removeMode, setRemoveMode] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);

  const filter = {
    date: selectedDate,
    orderType: category === "all" ? undefined : category,
    sort,
  };
  const {
    data: ordersPage,
    isLoading,
    mutate: refetchOrders,
  } = useOrdersPage(filter, page, PAGE_SIZE);
  const orders = ordersPage?.orders ?? [];
  const total = ordersPage?.total ?? 0;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  // Changing the date, category, or sort order invalidates whatever page we were on.
  useEffect(() => {
    setPage(1);
  }, [selectedDate, category, sort]);

  // Unfiltered, just to gate "Generar cierre del día" - the category filter above
  // shouldn't make the button disappear/disable just because e.g. "Domicilio" is
  // empty while the day still has dine_in orders.
  const { data: ordersToday = [], mutate: refetchOrdersToday } =
    useOrdersByFilter({ date: selectedDate });
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
  const isAdmin = useSessionStore((s) => s.employee?.role === "admin");
  // Closing reports are admin-only to review too (see routes/endOfDay.ts) -
  // skip the request entirely for non-admins instead of hitting a 401.
  const { data: closingReports = [] } = useClosingReports(isAdmin);

  const handleOrderDeleted = () => {
    setDeleteTarget(null);
    pushToast("Orden eliminada");
    refetchOrders();
    refetchOrdersToday();
  };

  const isToday = selectedDate === today;
  const reportForDate = useMemo(
    () =>
      closingReports
        .filter((r) => r.date === selectedDate)
        .sort((a, b) => b.id - a.id)[0],
    [closingReports, selectedDate],
  );

  // Any employee can generate the closing report now, as long as every one
  // of today's orders is already COMPLETED - the server enforces this too
  // (see endOfDayService.closeDay), this is just the matching UI gate.
  const hasOpenOrders = ordersToday.some((o) => o.status !== "COMPLETED");

  const handleGenerateReport = async () => {
    setGenerating(true);
    try {
      const report = await closeDay();
      pushToast("Cierre generado");
      // Reviewing a report is still admin-only (see routes/endOfDay.ts) -
      // don't send a non-admin to a detail page that'll just bounce them
      // back out.
      if (isAdmin) {
        navigate({
          to: "/dashboard/closing-reports",
          search: { reportId: report.id },
        });
      }
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : "No se pudo generar el cierre",
        "error",
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text-primary">
          Historial de órdenes
        </h1>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setRemoveMode((v) => !v)}
            className={classNames(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-fast",
              removeMode
                ? "border-danger bg-danger/10 text-danger"
                : "border-border text-text-secondary hover:border-danger hover:text-danger",
            )}
          >
            <Trash2 size={14} /> {removeMode ? "Terminar" : "Eliminar órdenes"}
          </button>
        )}
      </div>

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
          <Calendar
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            maxDate={today}
          />
        </div>

        <div className="min-w-64 flex-1">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col">
              <h2 className="font-semibold capitalize text-text-primary">
                {formatDateLong(selectedDate)}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {categories.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={classNames(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors duration-fast",
                      category === c.value
                        ? "bg-brand-500 text-white"
                        : "bg-brand-500/10 text-text-secondary hover:text-brand-600",
                    )}
                  >
                    {c.label}
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setSort((s) => (s === "newest" ? "oldest" : "newest"))}
                  title={sort === "newest" ? "Más recientes primero" : "Más antiguas primero"}
                  className="ml-1 flex items-center gap-1 rounded-full bg-brand-500/10 px-3 py-1 text-xs font-medium text-text-secondary transition-colors duration-fast hover:text-brand-600"
                >
                  {sort === "newest" ? <ArrowDownNarrowWide size={13} /> : <ArrowUpNarrowWide size={13} />}
                  {sort === "newest" ? "Más recientes" : "Más antiguas"}
                </button>
              </div>
            </div>

            {isToday ? (
              <button
                type="button"
                onClick={handleGenerateReport}
                disabled={
                  generating || ordersToday.length === 0 || hasOpenOrders
                }
                title={
                  ordersToday.length === 0
                    ? "No hay órdenes hoy todavía"
                    : hasOpenOrders
                      ? "Todas las órdenes de hoy deben estar completadas antes de generar el cierre"
                      : undefined
                }
                className="rounded-full bg-success px-4 py-2 text-sm font-semibold text-white transition-opacity duration-fast hover:opacity-90 disabled:opacity-60"
              >
                {generating ? "Generando..." : "Generar cierre del día"}
              </button>
            ) : (
              reportForDate && (
                <button
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/dashboard/closing-reports",
                      search: { reportId: reportForDate.id },
                    })
                  }
                  className="rounded-full border border-brand-400 px-4 py-2 text-sm font-semibold text-brand-600 transition-colors duration-fast hover:bg-brand-500/10"
                >
                  Ver cierre del día
                </button>
              )
            )}
          </div>

          <div className="flex flex-col gap-3">
            {isLoading && (
              <p className="text-sm text-text-secondary">Cargando órdenes...</p>
            )}
            {!isLoading && orders.length === 0 && (
              <p className="text-sm text-text-secondary">
                No hay órdenes para este día.
              </p>
            )}
            {orders.map((order) => (
              <OrderHistoryCard
                key={order.id}
                order={order}
                removeMode={isAdmin && removeMode}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>

          {!isLoading && total > 0 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-text-secondary">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)}{" "}
                de {total}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(p - 1, 1))}
                  disabled={page <= 1}
                  aria-label="Página anterior"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600 disabled:opacity-40"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-text-secondary">
                  Página {page} de {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                  disabled={page >= totalPages}
                  aria-label="Página siguiente"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-text-secondary transition-colors duration-fast hover:border-brand-400 hover:text-brand-600 disabled:opacity-40"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <DeleteOrderModal
        order={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={handleOrderDeleted}
      />
    </div>
  );
}
