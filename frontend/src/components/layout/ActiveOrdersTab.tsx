import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { Bike, ChevronDown, ChevronUp, ClipboardList, ShoppingBag } from 'lucide-react';
import classNames from 'classnames';
import { useOrderStore } from '@/store/useOrderStore';
import { timeAgo } from '@/lib/date';

const POSITION_STORAGE_KEY = 'dinapoli:activeOrdersBubblePosition';
const EDGE_MARGIN = 8;

// Stored as distance-from-right/bottom, not left/top: the panel renders
// above the button (flex-col), so anchoring from the bottom keeps the button
// visually in place and lets the panel grow upward when opened - anchoring
// from the top instead made the button jump down by the panel's height.
interface BubblePosition {
  right: number;
  bottom: number;
}

function loadStoredPosition(): BubblePosition | null {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.right === 'number' && typeof parsed?.bottom === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originRight: number;
  originBottom: number;
  moved: boolean;
}

export function ActiveOrdersTab() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [, forceTick] = useState(0);
  const [dragPosition, setDragPosition] = useState<BubblePosition | null>(loadStoredPosition);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);

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

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Keep a manually-placed bubble on-screen if the window is resized (e.g.
  // rotating a tablet) after its position was saved.
  useEffect(() => {
    if (!dragPosition) return;
    const onResize = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      const width = rect?.width ?? 0;
      const height = rect?.height ?? 0;
      setDragPosition((pos) => {
        if (!pos) return pos;
        const right = clamp(pos.right, EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
        const bottom = clamp(pos.bottom, EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
        return right === pos.right && bottom === pos.bottom ? pos : { right, bottom };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [dragPosition]);

  const handleDragPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    suppressClickRef.current = false;
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originRight: window.innerWidth - rect.right,
      originBottom: window.innerHeight - rect.bottom,
      moved: false,
    };
  };

  const handleDragPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    suppressClickRef.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 0;
    const height = rect?.height ?? 0;
    setDragPosition({
      right: clamp(drag.originRight - dx, EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN),
      bottom: clamp(drag.originBottom - dy, EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN),
    });
  };

  const handleDragPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragStateRef.current = null;
    if (!drag.moved) return;
    setDragPosition((pos) => {
      if (pos) {
        try {
          localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos));
        } catch {
          // Storage unavailable (private mode, quota) - the bubble just resets on next load.
        }
      }
      return pos;
    });
  };

  const handleBubbleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setOpen((v) => !v);
  };

  if (pathname.startsWith('/dashboard') || pathname.startsWith('/ajustes')) return null;

  const orders = activeOrders.filter((o) => o.orderType !== 'dine_in');
  // Same collision check as ToastViewport: shift clear of the Order Overview
  // panel (w-80 + border) when it's showing on /menu.
  const orderOverviewVisible = pathname.startsWith('/menu') && (currentOrderId != null || cart.length > 0);

  const handleView = (orderId: number) => {
    openExistingOrder(orderId);
    setOpen(false);
    navigate({ to: '/menu' });
  };

  // Once the staff member has dragged the bubble somewhere, that placement
  // wins outright - stop auto-shifting it clear of the Order Overview panel.
  const style: CSSProperties | undefined = dragPosition
    ? { right: dragPosition.right, bottom: dragPosition.bottom, left: 'auto', top: 'auto' }
    : undefined;

  return (
    <div
      ref={containerRef}
      className={classNames(
        'fixed z-40 flex flex-col items-end gap-2',
        !dragPosition && [
          'transition-[right] duration-base md:bottom-[30px]',
          // On mobile, /menu's OrderOverview collapses to a full-width summary
          // bar fixed at bottom-16 (see OrderOverview.tsx) - sit above it
          // instead of the usual bottom-20 so the two don't overlap.
          orderOverviewVisible ? 'bottom-36 right-4 sm:right-16 md:bottom-[30px] md:right-[392px]' : 'bottom-20 right-4 sm:right-16',
        ],
      )}
      style={style}
    >
      {open && (
        <div className="anim-slide-up flex max-h-96 w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
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
        onClick={handleBubbleClick}
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
        onPointerCancel={handleDragPointerUp}
        aria-label="Órdenes activas (arrastrable)"
        style={{ touchAction: 'none' }}
        className="flex cursor-grab items-center gap-2 rounded-full border border-border bg-surface p-2.5 text-sm font-semibold text-text-primary shadow-md transition-transform duration-fast hover:scale-105 active:scale-95 active:cursor-grabbing sm:px-4"
      >
        <ClipboardList size={18} className="text-brand-600" />
        <span className="hidden sm:inline">Órdenes activas</span>
        {orders.length > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1 text-xs font-bold text-white">
            {orders.length}
          </span>
        )}
        <span className="hidden sm:inline">{open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}</span>
      </button>
    </div>
  );
}
