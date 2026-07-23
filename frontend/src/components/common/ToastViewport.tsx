import classNames from 'classnames';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useLocation } from '@tanstack/react-router';
import { useToastStore } from '@/store/useToastStore';
import { useOrderStore } from '@/store/useOrderStore';

const variantStyles = {
  success: 'border-success/30 bg-success-bg text-success',
  error: 'border-danger/30 bg-danger-bg text-danger',
  warning: 'border-warning/30 bg-warning-bg text-warning',
} as const;

const variantIcons = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
} as const;

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  // The Order Overview panel (see components/order/OrderOverview.tsx) is a fixed
  // w-80 sidebar docked to the right edge on /menu; clear it so toasts don't cover
  // its Enviar orden / Cobrar orden buttons.
  const { pathname } = useLocation();
  const currentOrderId = useOrderStore((s) => s.currentOrderId);
  const cart = useOrderStore((s) => s.cart);
  const orderOverviewVisible = pathname.startsWith('/menu') && (currentOrderId != null || cart.length > 0);

  if (toasts.length === 0) return null;

  return (
    <div
      className={classNames(
        'pointer-events-none fixed bottom-4 z-50 flex w-80 flex-col gap-2 transition-[right] duration-base',
        orderOverviewVisible ? 'right-[336px]' : 'right-4',
      )}
    >
      {toasts.map((toast) => {
        const Icon = variantIcons[toast.variant];
        return (
          <div
            key={toast.id}
            role="status"
            className={classNames(
              'anim-slide-in-right pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-md',
              variantStyles[toast.variant],
            )}
          >
            <Icon size={18} className="mt-0.5 shrink-0" />
            <span className="flex-1 text-text-primary">{toast.message}</span>
            <button type="button" onClick={() => dismiss(toast.id)} className="text-text-secondary hover:text-text-primary">
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
