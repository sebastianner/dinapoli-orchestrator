import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { useSessionStore } from '@/store/useSessionStore';

export const Route = createFileRoute('/dashboard')({
  component: DashboardLayout,
});

const tabs = [{ to: '/dashboard/order-history', label: 'Historial de órdenes' }] as const;

// All admin-only: closing reports expose the day's full sales/tips/discounts
// breakdown, employee management is self-explanatory, and cities/
// neighborhoods are operational config (see routes/endOfDay.ts,
// routes/employees.ts, routes/locations.ts).
const adminTabs = [
  { to: '/dashboard/closing-reports', label: 'Cierres del día' },
  { to: '/dashboard/employees', label: 'Empleados' },
  { to: '/dashboard/locations', label: 'Ciudades y barrios' },
  { to: '/dashboard/promos', label: 'Promociones' },
  { to: '/dashboard/table-assignments', label: 'Editar mesas' },
  { to: '/dashboard/menu-settings', label: 'Ajustes de menú' },
] as const;

function DashboardLayout() {
  const isAdmin = useSessionStore((s) => s.employee?.role === 'admin');
  const visibleTabs = isAdmin ? [...tabs, ...adminTabs] : tabs;

  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-1 border-b border-border bg-surface px-6">
        {visibleTabs.map((tab) => (
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
