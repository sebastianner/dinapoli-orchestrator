import { createFileRoute, Link, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard')({
  component: DashboardLayout,
});

const tabs = [
  { to: '/dashboard/order-history', label: 'Historial de órdenes' },
  { to: '/dashboard/closing-reports', label: 'Cierres del día' },
] as const;

function DashboardLayout() {
  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-1 border-b border-border bg-surface px-6">
        {tabs.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            className="border-b-2 border-transparent px-3 py-3 text-sm font-medium text-text-secondary transition-colors duration-fast hover:text-brand-600 data-[status=active]:border-brand-500 data-[status=active]:text-brand-600"
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
