import type {
  AnalyticsRange,
  CashExpense,
  CashFlowDay,
  CashRegisterSettings,
  City,
  ClosingReport,
  Customer,
  CustomersAnalytics,
  EmployeePerformance,
  HeatmapCell,
  ProductsAnalytics,
  FlavorAnalytics,
  FlavorAnalyticsCategory,
  PromoUsageSummary,
  SalesBreakdown,
  SalesSummary,
  SalesTrendPoint,
  CustomerAddress,
  Employee,
  EmployeeRole,
  Menu,
  Neighborhood,
  Order,
  OrderStatus,
  OrderType,
  PaymentSplitRequest,
  PromoSettings,
  PromoType,
  PropertyType,
  ProductSearchResult,
  PizzaFlavorSearchResult,
  AdminProduct,
  AdminDrinkFlavor,
  RestaurantTableSummary,
  PizzaAdminData,
  AdminPizzaGroup,
  AdminPizzaFlavor,
  PizzaGroupId,
} from '@/types/api';

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Set once by useSessionStore so a session-ending 401 clears it, without api.ts importing the store back (would be circular). */
let sessionExpiredHandler: (() => void) | null = null;
export function setSessionExpiredHandler(handler: () => void): void {
  sessionExpiredHandler = handler;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Coalesces concurrent 401s into a single refresh call instead of one per failed request. */
function attemptRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', { method: 'POST' })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function fetchJson(path: string, init?: RequestInit, isRetry = false): Promise<{ res: Response; body: unknown }> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  // Transparent refresh-token retry: the access token cookie expired or is
  // about to, so silently mint a new one from the refresh token and replay
  // this request once - this is what lets a shift-long session skip
  // re-login entirely. /auth/* calls never trigger this themselves, or a
  // failed login/refresh would recurse into another refresh attempt.
  if (res.status === 401 && !isRetry && !path.startsWith('/auth/')) {
    const refreshed = await attemptRefresh();
    if (refreshed) return fetchJson(path, init, true);
    sessionExpiredHandler?.();
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : res.statusText;
    throw new ApiError(res.status, message);
  }

  return { res, body };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { body } = await fetchJson(path, init);
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const patch = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined });
const del = <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body: body !== undefined ? JSON.stringify(body) : undefined });

// ---------- Menu ----------

export const fetchMenu = () => get<Menu>('/menu');

export const searchProducts = (query: string) => get<ProductSearchResult[]>(`/menu/search?q=${encodeURIComponent(query)}`);

export const searchPizzaFlavors = (query: string) => get<PizzaFlavorSearchResult[]>(`/menu/flavors/search?q=${encodeURIComponent(query)}`);

// ---------- Menu settings (admin) ----------

export const fetchAdminProducts = () => get<AdminProduct[]>('/products');
export interface AdminProductInput {
  categoryId?: string;
  name?: string;
  description?: string | null;
  price?: number;
  isAvailable?: boolean;
}
export const createAdminProduct = (input: AdminProductInput) => post<AdminProduct>('/products', input);
export const updateAdminProduct = (id: number, input: AdminProductInput) => put<AdminProduct>(`/products/${id}`, input);
export const updateAdminProductSize = (id: number, sizeId: string, price: number) =>
  put<AdminProduct>(`/products/${id}/sizes/${sizeId}`, { price });
export const deleteAdminProduct = (id: number) => del<{ status: string; id: number }>(`/products/${id}`);

// Shared drink-flavor library (e.g. "Coca-Cola") plus setting the exact set a
// given product offers (0 to many) - see menuService.setProductDrinkFlavors.
export const fetchDrinkFlavors = () => get<AdminDrinkFlavor[]>('/products/drink-flavors');
export const updateProductDrinkFlavors = (id: number, flavors: string[]) =>
  put<AdminProduct>(`/products/${id}/drink-flavors`, { flavors });

// ---------- Pizza settings (admin) ----------

export const fetchPizzaAdminData = () => get<PizzaAdminData>('/pizza-admin');
export const renamePizzaGroup = (groupId: PizzaGroupId, name: string) => put<AdminPizzaGroup>(`/pizza-admin/groups/${groupId}`, { name });
export const updatePizzaGroupSizePrice = (groupId: PizzaGroupId, sizeId: string, price: number | null) =>
  put<AdminPizzaGroup>(`/pizza-admin/groups/${groupId}/sizes/${sizeId}`, { price });
export interface PizzaFlavorInput {
  name?: string;
  description?: string | null;
  isAvailable?: boolean;
  groupIds?: PizzaGroupId[];
}
export const createPizzaFlavor = (input: Required<Pick<PizzaFlavorInput, 'name' | 'groupIds'>> & PizzaFlavorInput) =>
  post<AdminPizzaFlavor>('/pizza-admin/flavors', input);
export const updatePizzaFlavor = (id: number, input: PizzaFlavorInput) => put<AdminPizzaFlavor>(`/pizza-admin/flavors/${id}`, input);

// ---------- Auth ----------

export interface SessionResponse {
  employee: Employee;
}

/** password is only checked (and only accepted) for admin employees - staff log in by id alone. */
export const login = (employeeId: number, password?: string) => post<SessionResponse>('/auth/login', { employeeId, password });
export const refreshSession = () => post<SessionResponse>('/auth/refresh');
export const logoutSession = () => post<{ status: string }>('/auth/logout');
export const fetchCurrentSession = () => get<SessionResponse>('/auth/me');

// ---------- Employees ----------

export const fetchActiveEmployees = () => get<Employee[]>('/employees/active');
export const fetchInactiveEmployees = () => get<Employee[]>('/employees/inactive');
/** Admin only. `password` is required when `role` is 'admin', ignored/rejected otherwise. */
export const createEmployee = (name: string, pictureUrl?: string, role?: EmployeeRole, password?: string) =>
  post<Employee>('/employees', { name, pictureUrl, role, password });
export const deactivateEmployee = (id: number) => del<Employee>(`/employees/${id}`);
export const activateEmployee = (id: number) => post<Employee>(`/employees/${id}/activate`);
/** Admin only. Promoting to admin (or rotating an admin's password) requires `password`; demoting to staff drops any stored password. */
export const setEmployeeRole = (id: number, role: EmployeeRole, password?: string) =>
  put<Employee>(`/employees/${id}/role`, { role, password });

// ---------- Customers ----------

/** Fuzzy/typo-tolerant, matches against name and phone. Open, no auth. */
export const searchCustomers = (query: string) => get<Customer[]>(`/customers/search?q=${encodeURIComponent(query)}`);
export const fetchCustomer = (id: number) => get<Customer>(`/customers/${id}`);
export const createCustomer = (name: string, phone?: string, email?: string) => post<Customer>('/customers', { name, phone, email });
export const updateCustomer = (id: number, name?: string, phone?: string, email?: string) =>
  put<Customer>(`/customers/${id}`, { name, phone, email });
/** Admin only - the only customer-management action that is. */
export const deleteCustomer = (id: number) => del<{ status: string }>(`/customers/${id}`);

export interface CustomerAddressInput {
  streetAddress: string;
  addressLine2?: string;
  propertyType: PropertyType;
  neighborhoodId: number;
  apartmentNumber?: string;
  tower?: string;
  buildingName?: string;
  reference?: string;
}

export const createCustomerAddress = (customerId: number, input: CustomerAddressInput) =>
  post<CustomerAddress>(`/customers/${customerId}/addresses`, input);
export const updateCustomerAddress = (customerId: number, addressId: number, input: Partial<CustomerAddressInput>) =>
  put<CustomerAddress>(`/customers/${customerId}/addresses/${addressId}`, input);
export const deleteCustomerAddress = (customerId: number, addressId: number) =>
  del<{ status: string }>(`/customers/${customerId}/addresses/${addressId}`);
/** Distinct previously-used building/conjunto names for a neighborhood - the autocomplete just grows organically, custom values are always allowed too. */
export const suggestBuildingNames = (neighborhoodId: number, query: string) =>
  get<string[]>(`/customers/addresses/buildings?neighborhoodId=${neighborhoodId}&q=${encodeURIComponent(query)}`);

// ---------- Locations (cities/neighborhoods) ----------

export const fetchCities = () => get<City[]>('/locations/cities');
export const fetchNeighborhoods = (cityId: number) => get<Neighborhood[]>(`/locations/cities/${cityId}/neighborhoods`);
/** Admin only - operational config, same footing as cash-flow settings. */
export const createCity = (name: string, department?: string, country?: string) =>
  post<City>('/locations/cities', { name, department, country });
export const updateCity = (id: number, name?: string, department?: string, country?: string) =>
  put<City>(`/locations/cities/${id}`, { name, department, country });
export const deleteCity = (id: number) => del<{ status: string }>(`/locations/cities/${id}`);
export const createNeighborhood = (name: string, cityId: number, deliveryFee?: number) =>
  post<Neighborhood>('/locations/neighborhoods', { name, cityId, deliveryFee });
export const updateNeighborhood = (id: number, name?: string, deliveryFee?: number) =>
  put<Neighborhood>(`/locations/neighborhoods/${id}`, { name, deliveryFee });
export const deleteNeighborhood = (id: number) => del<{ status: string }>(`/locations/neighborhoods/${id}`);

// ---------- Promos ----------

/** Public - every order-placing screen needs current prices, not just admins. */
export const fetchPromoSettings = () => get<PromoSettings[]>('/promos');
/** Admin only. `sodaSurcharge` only applies to 'pizza_xl' - omit for 'duo', or omit entirely to leave it unchanged. */
export const updatePromoSettings = (promoType: PromoType, price: number, sodaSurcharge?: number) =>
  put<PromoSettings>(`/promos/${promoType}`, { price, sodaSurcharge });

// ---------- Tables ----------

export const fetchTables = () => get<RestaurantTableSummary[]>('/tables');
export const increaseTableCount = () => post<RestaurantTableSummary[]>('/tables/increase');
export const decreaseTableCount = () => post<RestaurantTableSummary[]>('/tables/decrease');

// ---------- Orders ----------

export interface FetchOrdersFilter {
  status?: OrderStatus;
  /** YYYY-MM-DD, Bogotá business day. */
  date?: string;
  orderType?: OrderType;
  /** Omitted keeps the backend's historical default (oldest first, by id). */
  sort?: 'newest' | 'oldest';
}

export const fetchOrders = (filter: FetchOrdersFilter = {}) => {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.date) params.set('date', filter.date);
  if (filter.orderType) params.set('orderType', filter.orderType);
  if (filter.sort) params.set('sort', filter.sort);
  const query = params.toString();
  return get<Order[]>(`/orders${query ? `?${query}` : ''}`);
};

export interface OrdersPage {
  orders: Order[];
  /** Total matches across every page, not just this page's length. */
  total: number;
}

/** Same filters as fetchOrders, but LIMIT/OFFSET-ed server-side; total count comes back via the X-Total-Count header. */
export const fetchOrdersPage = async (filter: FetchOrdersFilter, page: number, pageSize: number): Promise<OrdersPage> => {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.date) params.set('date', filter.date);
  if (filter.orderType) params.set('orderType', filter.orderType);
  if (filter.sort) params.set('sort', filter.sort);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const { res, body } = await fetchJson(`/orders?${params.toString()}`);
  const orders = body as Order[];
  return { orders, total: Number(res.headers.get('X-Total-Count') ?? orders.length) };
};
export const fetchOrder = (id: number) => get<Order>(`/orders/${id}`);
/**
 * Edits an order that isn't COMPLETED yet - adding items, removing items, or
 * both at once (a customer changing their mind before the check). Both are
 * optional; at least one must be non-empty. See orderService.editOrderItems -
 * a mixed edit prints as one combined kitchen ticket, not two.
 */
export const editOrderItems = (id: number, addItems?: unknown[], removeItemIds?: number[]) =>
  patch<Order>(`/orders/${id}/items`, { addItems, removeItemIds });
export const completeOrder = (id: number, payments?: PaymentSplitRequest[]) => post<Order>(`/orders/${id}/complete`, { payments });
/** Public, no auth required. Replaces a COMPLETED order's payment split wholesale - same total-coverage validation as completeOrder, just correcting the record after the fact instead of setting it for the first time. */
export const updateOrderPayments = (id: number, payments: PaymentSplitRequest[]) => put<Order>(`/orders/${id}/payments`, { payments });
export const reprintOrderDocument = (id: number, kind: 'kitchen_ticket' | 'bill') =>
  post<{ status: string; orderId: number; kind: string }>(`/orders/${id}/reprint`, { kind });
/**
 * Generates/prints the bill "now": resends whatever's already saved for this
 * order unless `force`, in which case it always regenerates - the payment
 * modal's post-payment "Imprimir factura" passes `force: true` so a stale
 * pre-payment preview never gets resent in place of the real invoice. `tip`/
 * `discount` only matter for a still-open dine-in order's first preview
 * (see orderService.printInvoice server-side).
 */
export const printInvoice = (id: number, opts: { tip?: number; discount?: number; force?: boolean } = {}) =>
  post<Order>(`/orders/${id}/invoice`, opts);
/** Admin only, irreversible - deletes the order and everything derived from it (items, payments, print jobs). */
export const deleteOrder = (id: number) => del<{ status: string; orderId: number }>(`/orders/${id}`);
export const updateOrderTable = (id: number, tableNumber: number) => put<Order>(`/orders/${id}/table`, { tableNumber });
export const updateOrderCustomer = (id: number, customerId: number, customerAddressId?: number) =>
  put<Order>(`/orders/${id}/customer`, { customerId, customerAddressId });

// ---------- Cash flow ----------

export const fetchCurrentCashFlow = () => get<CashFlowDay>('/cash-flow/current');
export const fetchCashFlowHistory = () => get<CashFlowDay[]>('/cash-flow');
export const fetchCashFlowExpenses = (id: number) => get<CashExpense[]>(`/cash-flow/${id}/expenses`);
export const updateCurrentCash = (amount: number) => put<CashFlowDay>('/cash-flow/current/amount', { amount });
export const fetchCashFlowSettings = () => get<CashRegisterSettings>('/cash-flow/settings');
export const updateCashFlowSettings = (defaultOpeningCash: number) => put<CashRegisterSettings>('/cash-flow/settings', { defaultOpeningCash });
export const addCashExpense = (amount: number, justification: string) => post<CashExpense>('/cash-flow/expenses', { amount, justification });

// ---------- End of day ----------

export const closeDay = () => post<ClosingReport>('/end-of-day/close');
export const fetchClosingReports = () => get<ClosingReport[]>('/end-of-day');
export const fetchClosingReport = (id: number) => get<ClosingReport>(`/end-of-day/${id}`);
export const reprintClosingReport = (id: number) => post<{ status: string; id: number }>(`/end-of-day/${id}/reprint`);

// ---------- Analytics ----------

/** Builds the shared `range=...&from=...&to=...` query string every analytics endpoint accepts. */
function rangeQuery(range: AnalyticsRange, from?: string, to?: string): string {
  const params = new URLSearchParams({ range });
  if (range === 'custom' && from && to) {
    params.set('from', from);
    params.set('to', to);
  }
  return params.toString();
}

export const fetchAnalyticsSummary = (range: AnalyticsRange, from?: string, to?: string) =>
  get<SalesSummary>(`/analytics/summary?${rangeQuery(range, from, to)}`);
export const fetchSalesTrend = (range: AnalyticsRange, from?: string, to?: string) =>
  get<SalesTrendPoint[]>(`/analytics/sales-trend?${rangeQuery(range, from, to)}`);
export const fetchAnalyticsBreakdown = (range: AnalyticsRange, from?: string, to?: string) =>
  get<SalesBreakdown>(`/analytics/breakdown?${rangeQuery(range, from, to)}`);
export const fetchAnalyticsHeatmap = (range: AnalyticsRange, from?: string, to?: string) =>
  get<HeatmapCell[]>(`/analytics/heatmap?${rangeQuery(range, from, to)}`);
export const fetchAnalyticsProducts = (range: AnalyticsRange, from?: string, to?: string) =>
  get<ProductsAnalytics>(`/analytics/products?${rangeQuery(range, from, to)}`);
export const fetchAnalyticsFlavors = (range: AnalyticsRange, category?: FlavorAnalyticsCategory, from?: string, to?: string) => {
  const query = rangeQuery(range, from, to);
  return get<FlavorAnalytics>(`/analytics/flavors?${query}${category ? `&category=${category}` : ''}`);
};
export const fetchAnalyticsCustomers = (range: AnalyticsRange, from?: string, to?: string) =>
  get<CustomersAnalytics>(`/analytics/customers?${rangeQuery(range, from, to)}`);
export const fetchAnalyticsEmployees = (range: AnalyticsRange, from?: string, to?: string) =>
  get<EmployeePerformance[]>(`/analytics/employees?${rangeQuery(range, from, to)}`);
export const fetchAnalyticsPromotions = (range: AnalyticsRange, from?: string, to?: string) =>
  get<PromoUsageSummary>(`/analytics/promotions?${rangeQuery(range, from, to)}`);

export { ApiError };
