import classNames from 'classnames';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useLocation } from '@tanstack/react-router';
import { useToastStore } from '@/store/useToastStore';

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

  // The main Sidebar (w-20, sm:w-24) is always on the left; the CategorySidebar
  // (w-28) stacks next to it on /menu routes only. Clear whichever is present so
  // toasts never sit under either.
  const { pathname } = useLocation();
  const categorySidebarVisible = pathname.startsWith('/menu');

  if (toasts.length === 0) return null;

  return (
    <div
      className={classNames(
        'pointer-events-none fixed bottom-4 z-50 flex w-80 flex-col gap-2 transition-[left] duration-base',
        categorySidebarVisible ? 'left-[260px]' : 'left-32',
      )}
    >
      {toasts.map((toast) => {
        const Icon = variantIcons[toast.variant];
        return (
          <div
            key={toast.id}
            role="status"
            className={classNames(
              'anim-slide-up pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-md',
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
