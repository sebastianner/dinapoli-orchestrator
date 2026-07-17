// Row shapes as they come back from better-sqlite3, mirroring src/db/schema.sql.

export interface RestaurantTableRow {
  id: number;
  number: number;
  status: 'free' | 'busy';
}

export interface CategoryRow {
  id: number;
  key: string;
  name: string;
}

export interface ProductRow {
  id: number;
  category_id: number;
  key: string;
  name: string;
  description: string | null;
  price: number | null;
  is_available: 0 | 1;
  requires_pizza_flavor: 0 | 1;
}

export interface ProductWithCategoryRow extends ProductRow {
  category_key: string;
}

export interface ProductSizeRow {
  id: number;
  product_id: number;
  key: string;
  name: string;
  price: number;
}

export interface ProductOptionRow {
  id: number;
  product_id: number;
  key: string;
  name: string;
}

export interface PizzaGroupRow {
  id: number;
  key: string;
  name: string;
}

export interface PizzaSizeRow {
  id: number;
  key: string;
  name: string;
  slices: number;
  max_flavors: number;
}

export interface PizzaGroupSizeRow {
  id: number;
  group_id: number;
  size_id: number;
  price: number | null;
}

export interface PizzaFlavorRow {
  id: number;
  key: string;
  name: string;
  description: string | null;
  extra_cost: number;
  is_available: 0 | 1;
}

export type OrderTypeDb = 'dine_in' | 'takeaway' | 'delivery';
export type OrderStatusDb = 'PENDING' | 'PRINTING' | 'ACTIVE' | 'COMPLETED';
export type PaymentMethodDb = 'cash' | 'card' | 'transfer';

export interface OrderRow {
  id: number;
  order_type: OrderTypeDb;
  status: OrderStatusDb;
  payment_method: PaymentMethodDb | null;
  table_number: number | null;
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  total: number;
  tip: number;
  delivery_fee: number;
  created_at: string;
  completed_at: string | null;
  print_attempts: number;
}

export type OrderItemType = 'pizza' | 'product';

export interface OrderItemRow {
  id: number;
  order_id: number;
  item_type: OrderItemType;
  product_id: number | null;
  product_size_id: number | null;
  product_option_id: number | null;
  pizza_group_id: number | null;
  pizza_size_id: number | null;
  pizza_flavor_id: number | null;
  quantity: number;
  unit_price: number;
  notes: string | null;
}

export type PrintJobKind = 'kitchen_ticket' | 'bill';

export interface PrintJobRow {
  id: number;
  order_id: number;
  kind: PrintJobKind;
  content: string;
  created_at: string;
}

export interface CashRegisterSettingsRow {
  id: 1;
  default_opening_cash: number;
}

export interface CashFlowRow {
  id: number;
  date: string;
  cash_in_register: number;
  expenses: number;
  created_at: string;
}

export interface CashExpenseRow {
  id: number;
  cash_flow_id: number;
  amount: number;
  justification: string;
  created_at: string;
}

export interface ClosingReportRow {
  id: number;
  date: string;
  order_count: number;
  delivery_sales: number;
  dine_in_takeaway_sales: number;
  cash_sales: number;
  card_sales: number;
  transfer_sales: number;
  total_sales: number;
  total_expenses: number;
  content: string;
  created_at: string;
}
