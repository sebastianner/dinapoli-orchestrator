import { useEffect } from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { ActiveOrdersTab } from '@/components/layout/ActiveOrdersTab';
import { ToastViewport } from '@/components/common/ToastViewport';
import { useMenu, useActiveEmployees, useTables } from '@/lib/queries';
import { fetchOrders } from '@/lib/api';
import { useOrderStore } from '@/store/useOrderStore';

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
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
