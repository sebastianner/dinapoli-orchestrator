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

export interface DrinkFlavorRow {
  id: number;
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

export interface EmployeeRow {
  id: number;
  name: string;
  picture_url: string | null;
  is_active: 0 | 1;
  role: 'staff' | 'admin';
  password_hash: string | null;
}

export interface RefreshTokenRow {
  id: number;
  employee_id: number;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export type OrderTypeDb = 'dine_in' | 'takeaway' | 'delivery';
export type OrderStatusDb = 'PENDING' | 'PRINTING' | 'ACTIVE' | 'COMPLETED';
export type PaymentMethodDb = 'cash' | 'card' | 'transfer';

export interface OrderRow {
  id: number;
  order_type: OrderTypeDb;
  status: OrderStatusDb;
  employee_id: number | null;
  table_number: number | null;
  customer_id: number | null;
  customer_address_id: number | null;
  notes: string | null;
  promo_type: string | null;
  /** "Delivery #N of the day" as printed, assigned at creation. NULL for non-delivery orders and pre-column rows. */
  delivery_day_number: number | null;
  total: number;
  created_at: string;
  completed_at: string | null;
  print_attempts: number;
}

export interface CityRow {
  id: number;
  name: string;
  department: string | null;
  country: string;
}

export interface NeighborhoodRow {
  id: number;
  name: string;
  city_id: number;
  delivery_fee: number;
}

export interface CustomerRow {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  created_at: string;
}

export type PropertyTypeDb = 'HOUSE' | 'APARTMENT' | 'OFFICE' | 'BUILDING' | 'OTHER';

export interface CustomerAddressRow {
  id: number;
  customer_id: number;
  street_address: string;
  address_line_2: string | null;
  property_type: PropertyTypeDb;
  neighborhood_id: number;
  apartment_number: string | null;
  tower: string | null;
  building_name: string | null;
  reference: string | null;
  latitude: number | null;
  longitude: number | null;
  google_place_id: string | null;
  formatted_address: string | null;
  created_at: string;
}

export interface OrderPaymentRow {
  id: number;
  order_id: number;
  method: PaymentMethodDb;
  gross_amount: number;
  tip_amount: number;
  delivery_fee: number;
  net_amount: number;
  discount: number;
  created_at: string;
}

export type OrderItemType = 'pizza' | 'product';

export interface OrderItemRow {
  id: number;
  order_id: number;
  item_type: OrderItemType;
  product_id: number | null;
  product_size_id: number | null;
  drink_flavor_id: number | null;
  pizza_group_id: number | null;
  pizza_size_id: number | null;
  pizza_flavor_id: number | null;
  quantity: number;
  unit_price: number;
  notes: string | null;
  /** 1 when this row is part of the order's promo rather than a normally-priced extra (see schema.sql). */
  promo_item: 0 | 1;
  printed_at: string | null;
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

export interface PromoSettingsRow {
  promo_type: 'duo' | 'pizza_xl';
  price: number;
  soda_surcharge: number;
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
  tips: number;
  discounts: number;
  items_sold: number;
  customers_served: number;
  delivery_order_count: number;
  dine_in_order_count: number;
  takeaway_order_count: number;
  total_expenses: number;
  cash_in_register: number;
  content: string;
  created_at: string;
}
