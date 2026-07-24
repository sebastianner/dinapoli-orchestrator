import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Bike, ChevronDown, ChevronUp, ClipboardList, ShoppingBag } from 'lucide-react';
import classNames from 'classnames';
import { useOrderStore } from '@/store/useOrderStore';
import { timeAgo } from '@/lib/date';

export function ActiveOrdersTab() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [, forceTick] = useState(0);

  const activeOrders = useOrderStore((s) => s.activeOrders);
  const openExistingOrder = useOrderStore((s) => s.openExistingOrder);
  const currentOrderId = useOrderStore((s) => s.currentOrderId);
  const cart = useOrderStore((s) => s.cart);
  const navigate = useNavigate();

  // Re-render periodically so "hace N minutos" stays current without a full refetch.
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (pathname.startsWith('/dashboard')) return null;

  const orders = activeOrders.filter((o) => o.orderType !== 'dine_in');
  // Same collision check as ToastViewport: shift clear of the Order Overview
  // panel (w-80 + border) when it's showing on /menu.
  const orderOverviewVisible = pathname.startsWith('/menu') && (currentOrderId != null || cart.length > 0);

  const handleView = (orderId: number) => {
    openExistingOrder(orderId);
    setOpen(false);
    navigate({ to: '/menu' });
  };

  return (
    <div
      className={classNames(
        'fixed bottom-[30px] z-40 flex flex-col items-end gap-2 transition-[right] duration-base',
        orderOverviewVisible ? 'right-[392px]' : 'right-16',
      )}
    >
      {open && (
        <div className="anim-slide-up flex max-h-96 w-72 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
          <div className="border-b border-border px-4 py-3">
            <h3 className="font-semibold text-text-primary">Órdenes activas</h3>
          </div>
          <ul className="flex flex-col divide-y divide-border overflow-y-auto">
            {orders.length === 0 && (
              <li className="px-4 py-4 text-sm text-text-secondary">No hay domicilios o pedidos para llevar activos.</li>
            )}
            {orders.map((order) => {
              const Icon = order.orderType === 'delivery' ? Bike : ShoppingBag;
              return (
                <li key={order.id} className="flex items-center justify-between gap-2 px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon size={16} className="shrink-0 text-brand-600" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">{order.customerName ?? `Orden #${order.id}`}</p>
                      <p className="text-xs text-text-secondary">{timeAgo(order.createdAt)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleView(order.id)}
                    className="shrink-0 rounded-full border border-brand-400 px-3 py-1 text-xs font-semibold text-brand-600 transition-colors duration-fast hover:bg-brand-500/10"
                  >
                    Ver
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary shadow-md transition-transform duration-fast hover:scale-105 active:scale-95"
      >
        <ClipboardList size={18} className="text-brand-600" />
        Órdenes activas
        {orders.length > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1 text-xs font-bold text-white">
            {orders.length}
          </span>
        )}
        {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
    </div>
  );
}
