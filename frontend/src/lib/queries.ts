import useSWR from 'swr';
import {
  fetchActiveEmployees,
  fetchAdminProducts,
  fetchCashFlowExpenses,
  fetchCashFlowHistory,
  fetchCashFlowSettings,
  fetchCities,
  fetchClosingReport,
  fetchClosingReports,
  fetchCurrentCashFlow,
  fetchCustomer,
  fetchInactiveEmployees,
  fetchMenu,
  fetchNeighborhoods,
  fetchOrder,
  fetchOrders,
  fetchOrdersPage,
  fetchPizzaAdminData,
  fetchPromoSettings,
  fetchTables,
  searchCustomers,
  searchProducts,
  suggestBuildingNames,
  type FetchOrdersFilter,
} from '@/lib/api';

// Rarely-changing data: cached with SWR instead of re-fetched on every mount.
// Active orders are handled separately (see useOrderStore) since they change
// frequently and are also kept in sync over the order WebSocket.

export function useMenu() {
  return useSWR('/menu', fetchMenu);
}

/** Fuzzy/typo-tolerant product search across every category (see /menu/todos). Caller is expected to debounce `query` itself, same as useCustomerSearch. */
export function useProductSearch(query: string) {
  const trimmed = query.trim();
  return useSWR(trimmed.length > 0 ? `/menu/search?q=${trimmed}` : null, () => searchProducts(trimmed));
}

/** Admin only (see routes/products.ts) - every product regardless of availability, for /ajustes/menu-settings. */
export function useAdminProducts() {
  return useSWR('/products', fetchAdminProducts);
}

/** Admin only (see routes/pizzaAdmin.ts) - pizza groups/sizes/flavors for /ajustes/menu-settings. */
export function usePizzaAdminData() {
  return useSWR('/pizza-admin', fetchPizzaAdminData);
}

export function useActiveEmployees() {
  return useSWR('/employees/active', fetchActiveEmployees);
}

/** Only shown when switching employees mid-session, not on the initial select-employee gate (see select-employee.tsx) - pass enabled: false to skip the fetch there entirely. */
export function useInactiveEmployees(enabled = true) {
  return useSWR(enabled ? '/employees/inactive' : null, fetchInactiveEmployees);
}

export function useTables() {
  return useSWR('/tables', fetchTables);
}

/** Public - the current promo prices, needed by every order-placing screen (see menu/promos.tsx, useOrderStore.startPromo/addPromoItem) as well as the admin editing page. */
export function usePromoSettings() {
  return useSWR('/promos', fetchPromoSettings);
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

export function useCustomer(id: number | null) {
  return useSWR(id != null ? `/customers/${id}` : null, () => fetchCustomer(id as number));
}

/** Caller is expected to debounce `query` itself (e.g. CustomerAutocomplete) - this hook just wraps the fetch. */
export function useCustomerSearch(query: string) {
  const trimmed = query.trim();
  return useSWR(trimmed.length > 0 ? `/customers/search?q=${trimmed}` : null, () => searchCustomers(trimmed));
}

export function useCities() {
  return useSWR('/locations/cities', fetchCities);
}

export function useNeighborhoods(cityId: number | null) {
  return useSWR(cityId != null ? `/locations/cities/${cityId}/neighborhoods` : null, () => fetchNeighborhoods(cityId as number));
}

/** Caller is expected to debounce `query` itself, same as useCustomerSearch. */
export function useBuildingSuggestions(neighborhoodId: number | null, query: string) {
  const trimmed = query.trim();
  return useSWR(neighborhoodId != null ? `/customers/addresses/buildings?neighborhoodId=${neighborhoodId}&q=${trimmed}` : null, () =>
    suggestBuildingNames(neighborhoodId as number, trimmed)
  );
}
