import type {
  CashExpense,
  CashFlowDay,
  CashRegisterSettings,
  ClosingReport,
  Employee,
  EmployeeRole,
  Menu,
  Order,
  OrderStatus,
  OrderType,
  PaymentSplitRequest,
  RestaurantTableSummary,
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
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// ---------- Menu ----------

export const fetchMenu = () => get<Menu>('/menu');

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

// ---------- Tables ----------

export const fetchTables = () => get<RestaurantTableSummary[]>('/tables');

// ---------- Orders ----------

export interface FetchOrdersFilter {
  status?: OrderStatus;
  /** YYYY-MM-DD, Bogotá business day. */
  date?: string;
  orderType?: OrderType;
}

export const fetchOrders = (filter: FetchOrdersFilter = {}) => {
  const params = new URLSearchParams();
  if (filter.status) params.set('status', filter.status);
  if (filter.date) params.set('date', filter.date);
  if (filter.orderType) params.set('orderType', filter.orderType);
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
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  const { res, body } = await fetchJson(`/orders?${params.toString()}`);
  const orders = body as Order[];
  return { orders, total: Number(res.headers.get('X-Total-Count') ?? orders.length) };
};
export const fetchOrder = (id: number) => get<Order>(`/orders/${id}`);
export const addOrderItems = (id: number, items: unknown[]) => post<Order>(`/orders/${id}/items`, { items });
export const completeOrder = (id: number, payments?: PaymentSplitRequest[]) => post<Order>(`/orders/${id}/complete`, { payments });
export const reprintOrderDocument = (id: number, kind: 'kitchen_ticket' | 'bill') =>
  post<{ status: string; orderId: number; kind: string }>(`/orders/${id}/reprint`, { kind });
/** Admin only, irreversible - deletes the order and everything derived from it (items, payments, print jobs). */
export const deleteOrder = (id: number) => del<{ status: string; orderId: number }>(`/orders/${id}`);

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

export { ApiError };
