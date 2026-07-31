import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useSessionStore } from '@/store/useSessionStore';

export const Route = createFileRoute('/dashboard')({
  component: DashboardLayout,
});

// Open to every employee - unlike /ajustes (admin-only). Closing reports
// expose the whole day's sales breakdown, so that one tab/page stays
// admin-gated on its own (same as before /ajustes existed).
const tabs = [{ to: '/dashboard/order-history', label: 'Historial de órdenes' }] as const;

const adminTabs = [{ to: '/dashboard/closing-reports', label: 'Cierres del día' }] as const;

function DashboardLayout() {
  const isAdmin = useSessionStore((s) => s.employee?.role === 'admin');
  const visibleTabs = isAdmin ? [...tabs, ...adminTabs] : tabs;

  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-4 sm:px-6">
        {visibleTabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="shrink-0 whitespace-nowrap border-b-2 border-transparent px-3 py-3 text-sm font-medium text-text-secondary transition-colors duration-fast hover:text-brand-600 data-[status=active]:border-brand-500 data-[status=active]:text-brand-600"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
