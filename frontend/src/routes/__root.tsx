import { useEffect, useState } from 'react';
import { createRootRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import classNames from 'classnames';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { ActiveOrdersTab } from '@/components/layout/ActiveOrdersTab';
import { LiveOrderUpdates } from '@/components/layout/LiveOrderUpdates';
import { ToastViewport } from '@/components/common/ToastViewport';
import { OrderNotification } from '@/components/common/OrderNotification';
import { useMenu, useActiveEmployees, useTables } from '@/lib/queries';
import { fetchOrders, fetchCurrentSession } from '@/lib/api';
import { useOrderStore } from '@/store/useOrderStore';
import { useSessionStore } from '@/store/useSessionStore';

const SELECT_EMPLOYEE_PATH = '/select-employee';

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
  // sessionChecked gates the enforcement below so a logged-in user doesn't
  // get bounced to /select-employee during the brief gap before this
  // resolves.
  const [sessionChecked, setSessionChecked] = useState(false);
  const setSessionEmployee = useSessionStore((s) => s.setEmployee);
  useEffect(() => {
    fetchCurrentSession()
      .then((r) => setSessionEmployee(r.employee))
      .catch(() => setSessionEmployee(null))
      .finally(() => setSessionChecked(true));
  }, [setSessionEmployee]);

  // No employee selected -> no access to anything else, full stop (see
  // Todo.MD "User Selection Enforcement" - prevents an order from ever being
  // attributed to the wrong person, or nobody at all; the backend enforces
  // the same rule independently on order creation). Also fires whenever an
  // active session unexpectedly ends (e.g. a 401 that survives the refresh
  // retry - see setSessionExpiredHandler in lib/api.ts), not just on boot.
  const employee = useSessionStore((s) => s.employee);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (sessionChecked && !employee && pathname !== SELECT_EMPLOYEE_PATH) {
      navigate({ to: SELECT_EMPLOYEE_PATH, replace: true });
    }
  }, [sessionChecked, employee, pathname, navigate]);

  // Before the session check resolves, or while a redirect to
  // /select-employee is in flight, render nothing but a blank shell instead
  // of a flash of the wrong route's content or the full app chrome.
  if (!sessionChecked || (!employee && pathname !== SELECT_EMPLOYEE_PATH)) {
    return <div className="h-screen w-screen bg-bg" />;
  }

  // No app chrome (sidebar/header/active-orders) while no employee is
  // selected - literally just the selection screen, so there's nothing to
  // click through to the rest of the app with.
  if (!employee) {
    return (
      <div className="h-screen w-screen overflow-y-auto bg-bg text-text-primary">
        <Outlet />
        <ToastViewport />
      </div>
    );
  }

  return <UnlockedApp />;
}

/** Split out so the push-in-right transition (see select-employee.tsx) is read exactly once per mount of the unlocked app shell - not re-evaluated on every RootLayout re-render. */
function UnlockedApp() {
  const consumeJustSelected = useSessionStore((s) => s.consumeJustSelected);
  const [justSelected] = useState(consumeJustSelected);

  return (
    <div className={classNames('flex h-screen w-screen overflow-hidden bg-bg text-text-primary', justSelected && 'anim-push-in-right')}>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1 overflow-y-auto pb-16 md:pb-0">
          <Outlet />
        </main>
      </div>
      <ActiveOrdersTab />
      <ToastViewport />
      <OrderNotification />
      <LiveOrderUpdates />
    </div>
  );
}

export const Route = createRootRoute({ component: RootLayout });
