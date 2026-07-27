import { useEffect } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { ActiveOrdersTab } from '@/components/layout/ActiveOrdersTab';
import { ToastViewport } from '@/components/common/ToastViewport';
import { OrderNotification } from '@/components/common/OrderNotification';
import { useMenu, useActiveEmployees, useTables } from '@/lib/queries';
import { fetchOrders, fetchCurrentSession } from '@/lib/api';
import { useOrderStore } from '@/store/useOrderStore';
import { useSessionStore } from '@/store/useSessionStore';

function RootLayout() {
  // Warm the SWR cache for rarely-changing data as soon as the app boots, so
  // every page that reads it (Menu, Select Employee, Tables) hits the cache
  // instead of triggering its own fetch waterfall.
  useMenu();
  useActiveEmployees();
  useTables();

  const setActiveOrders = useOrderStore((s) => s.setActiveOrders);
  useEffect(() => {
    fetchOrders({ status: 'ACTIVE' }).then(setActiveOrders).catch(console.error);
  }, [setActiveOrders]);

  // The cached employee (see useSessionStore) is only a paint guess - the
  // httpOnly cookie session is the real source of truth, so re-derive it
  // from the server on every boot. fetchJson's transparent refresh-retry
  // (lib/api.ts) already covers a merely-expired access token; this only
  // ends up clearing the session if there's truly nothing valid left.
  const setSessionEmployee = useSessionStore((s) => s.setEmployee);
  useEffect(() => {
    fetchCurrentSession()
      .then((r) => setSessionEmployee(r.employee))
      .catch(() => setSessionEmployee(null));
  }, [setSessionEmployee]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-text-primary">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <ActiveOrdersTab />
      <ToastViewport />
      <OrderNotification />
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
