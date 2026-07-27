import useSWR from 'swr';
import {
  fetchActiveEmployees,
  fetchCashFlowExpenses,
  fetchCashFlowHistory,
  fetchCashFlowSettings,
  fetchClosingReport,
  fetchClosingReports,
  fetchCurrentCashFlow,
  fetchInactiveEmployees,
  fetchMenu,
  fetchOrder,
  fetchOrders,
  fetchOrdersPage,
  fetchTables,
  type FetchOrdersFilter,
} from '@/lib/api';

// Rarely-changing data: cached with SWR instead of re-fetched on every mount.
// Active orders are handled separately (see useOrderStore) since they change
// frequently and are also kept in sync over the order WebSocket.

export function useMenu() {
  return useSWR('/menu', fetchMenu);
}

export function useActiveEmployees() {
  return useSWR('/employees/active', fetchActiveEmployees);
}

export function useInactiveEmployees() {
  return useSWR('/employees/inactive', fetchInactiveEmployees);
}

export function useTables() {
  return useSWR('/tables', fetchTables);
}

/** Up-to-date detail for a single order, e.g. after reconnecting or deep-linking into it. */
export function useOrder(id: number | null) {
  return useSWR(id != null ? `/orders/${id}` : null, () => fetchOrder(id as number));
}

export function useOrdersByFilter(filter: FetchOrdersFilter) {
  const key = `/orders?${JSON.stringify(filter)}`;
  return useSWR(key, () => fetchOrders(filter));
}

/** Paginated variant for lists that can grow large (e.g. Order History) - one page at a time instead of every match. */
export function useOrdersPage(filter: FetchOrdersFilter, page: number, pageSize: number) {
  const key = `/orders?${JSON.stringify(filter)}&page=${page}&pageSize=${pageSize}`;
  return useSWR(key, () => fetchOrdersPage(filter, page, pageSize));
}

export function useCurrentCashFlow() {
  return useSWR('/cash-flow/current', fetchCurrentCashFlow);
}

export function useCashFlowHistory() {
  return useSWR('/cash-flow', fetchCashFlowHistory);
}

/** Admin only on the backend (see routes/cashFlow.ts) - pass enabled: false for non-admins to skip the request entirely instead of hitting a 401. */
export function useCashFlowSettings(enabled = true) {
  return useSWR(enabled ? '/cash-flow/settings' : null, fetchCashFlowSettings);
}

export function useCashFlowExpenses(cashFlowId: number | null) {
  return useSWR(cashFlowId != null ? `/cash-flow/${cashFlowId}/expenses` : null, () => fetchCashFlowExpenses(cashFlowId as number));
}

/** Admin only on the backend (see routes/endOfDay.ts) - pass enabled: false for non-admins to skip the request entirely instead of hitting a 401. */
export function useClosingReports(enabled = true) {
  return useSWR(enabled ? '/end-of-day' : null, fetchClosingReports);
}

export function useClosingReport(id: number | null, enabled = true) {
  return useSWR(enabled && id != null ? `/end-of-day/${id}` : null, () => fetchClosingReport(id as number));
}
