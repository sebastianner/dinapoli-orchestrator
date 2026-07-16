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
