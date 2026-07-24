import type {
  CashExpense,
  CashFlowDay,
  CashRegisterSettings,
  ClosingReport,
  Employee,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

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

  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined });
const put = <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// ---------- Menu ----------

export const fetchMenu = () => get<Menu>('/menu');

// ---------- Employees ----------

export const fetchActiveEmployees = () => get<Employee[]>('/employees/active');
export const fetchInactiveEmployees = () => get<Employee[]>('/employees/inactive');
export const createEmployee = (name: string, pictureUrl?: string) => post<Employee>('/employees', { name, pictureUrl });
export const deactivateEmployee = (id: number) => del<Employee>(`/employees/${id}`);
export const activateEmployee = (id: number) => post<Employee>(`/employees/${id}/activate`);

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
export const fetchOrder = (id: number) => get<Order>(`/orders/${id}`);
export const addOrderItems = (id: number, items: unknown[]) => post<Order>(`/orders/${id}/items`, { items });
export const completeOrder = (id: number, payments?: PaymentSplitRequest[]) => post<Order>(`/orders/${id}/complete`, { payments });
export const reprintOrderDocument = (id: number, kind: 'kitchen_ticket' | 'bill') =>
  post<{ status: string; orderId: number; kind: string }>(`/orders/${id}/reprint`, { kind });

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
