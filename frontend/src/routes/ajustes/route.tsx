import { createFileRoute, redirect, Link, Outlet } from '@tanstack/react-router';
import { useSessionStore } from '@/store/useSessionStore';

export const Route = createFileRoute('/ajustes')({
  beforeLoad: () => {
    // The whole /ajustes section is admin-only - bounce anyone else out
    // before any of its pages even load. Individual pages below no longer
    // need their own copy of this check. Order history and closing reports
    // live under the separate, open-to-everyone /dashboard instead (closing
    // reports keeps its own admin check there since that section isn't
    // gated at the layout level).
    if (useSessionStore.getState().employee?.role !== 'admin') {
      throw redirect({ to: '/tables' });
    }
  },
  component: AjustesLayout,
});

const tabs = [
  { to: '/ajustes/employees', label: 'Empleados' },
  { to: '/ajustes/ubicaciones', label: 'Ciudades y barrios' },
  { to: '/ajustes/promos', label: 'Promociones' },
  { to: '/ajustes/table-assignments', label: 'Editar mesas' },
  { to: '/ajustes/menu-settings', label: 'Ajustes de menú' },
] as const;

function AjustesLayout() {
  return (
    <div className="flex h-full flex-col">
      <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-4 sm:px-6">
        {tabs.map((tab) => (
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
