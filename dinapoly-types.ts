// ============================================================
// Gooners Pizza — shared type definitions
// Matches menu.json structure and the client order payload.
// ============================================================

// ---------- Shared literals ----------

export type OrderType = 'dine_in' | 'takeaway' | 'delivery';

export type PaymentMethod = 'cash' | 'card' | 'transfer';

export type OrderStatus = 'PENDING' | 'PRINTING' | 'ACTIVE' | 'COMPLETED';

export type PizzaGroupId = 'classic' | 'special';

export type PizzaSizeId =
  | 'slice'
  | 'personal'
  | 'small'
  | 'medium'
  | 'large'
  | 'xlarge';

// ============================================================
// MENU (shape of menu.json)
// ============================================================

export interface Menu {
  menu: MenuCategory[];
}

/** A top-level menu category is either the pizzas category (groups) or a product category. */
export type MenuCategory = PizzaCategory | ProductCategory;

export interface PizzaCategory {
  id: 'pizzas';
  name: string;
  groups: PizzaGroup[];
}

export interface PizzaGroup {
  id: PizzaGroupId;
  name: string;
  sizes: PizzaSize[];
  flavors: PizzaFlavor[];
}

export interface PizzaSize {
  id: PizzaSizeId;
  name: string;
  slices: number;
  maxFlavors: number;
  /** Absent for 'slice' in the current menu data. */
  price?: number;
}

export interface PizzaFlavor {
  id: string;
  name: string;
  description: string;
}

export interface ProductCategory {
  id: string; // 'appetizers' | 'gratinados' | 'calzones' | 'pastas' | 'lasagnas' | 'drinks' | 'desserts'
  name: string;
  products: Product[];
}

export interface Product {
  id: string;
  name: string;
  /** Absent when the product is priced per size (e.g. calzone). */
  price?: number;
  /** Present when the product comes in sizes with their own price (calzone). */
  sizes?: ProductSize[];
  /** Selectable variants that don't affect price (drinks). */
  options?: string[];
  /** True when the product takes a pizza flavor (gratinados, calzones). */
  pizzaFlavor?: boolean;
}

export interface ProductSize {
  id: string;
  name: string;
  price: number;
}

// ============================================================
// ORDER REQUEST (client -> server payload)
// Client sends references and quantities only. Prices are
// always resolved server-side from the menu.
// ============================================================

export interface OrderRequest {
  orderType: OrderType;
  /** Required when orderType = 'dine_in'. 1-9. */
  tableNumber?: number;
  /** Required for 'takeaway' (name) and 'delivery' (name, phone, address). */
  customer?: CustomerInfo;
  paymentMethod?: PaymentMethod;
  notes?: string;
  items: OrderItemRequest[];
}

export interface CustomerInfo {
  name: string;
  phone?: string;
  address?: string;
}

export type OrderItemRequest = PizzaItemRequest | ProductItemRequest;

export interface PizzaItemRequest {
  type: 'pizza';
  size: PizzaSizeId;
  /**
   * Flavor ids, length 1..maxFlavors of the size. The group is not chosen by
   * the client: the server derives it from the flavors picked (mixing in any
   * 'special' flavor upgrades the whole pizza to the special price for this size).
   */
  flavors: string[];
  quantity: number;
  notes?: string;
}

export interface ProductItemRequest {
  type: 'product';
  /** ProductCategory id, e.g. 'pastas', 'drinks'. */
  category: string;
  /** Product id within that category. */
  product: string;
  /** One of the product's options (drinks). */
  option?: string;
  /** ProductSize id when the product is priced per size (calzone). */
  size?: string;
  /** Pizza flavor id when the product has pizzaFlavor: true. */
  pizzaFlavor?: string;
  quantity: number;
  notes?: string;
}

// ============================================================
// ORDER (server-side representation, mirrors the DB schema)
// ============================================================

export interface Order {
  id: number;
  orderType: OrderType;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  tableNumber: number | null;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  /** Integer COP. Computed server-side. */
  total: number;
  notes: string | null;
  createdAt: string; // ISO / SQLite datetime
  completedAt: string | null;
  items: OrderItem[];
}

export interface OrderItem {
  id: number;
  orderId: number;
  /** Null when the line is a pizza. */
  menuItemRef: ProductRef | null;
  /** Null when the line is not a pizza. */
  pizzaRef: PizzaRef | null;
  quantity: number;
  /** Price snapshot at order time, integer COP. */
  unitPrice: number;
  notes: string | null;
}

export interface ProductRef {
  category: string;
  product: string;
  option?: string;
  size?: string;
  pizzaFlavor?: string;
}

export interface PizzaRef {
  group: PizzaGroupId;
  size: PizzaSizeId;
  flavors: string[];
}

// ---------- Type guards ----------

export function isPizzaCategory(c: MenuCategory): c is PizzaCategory {
  return c.id === 'pizzas';
}

export function isPizzaItem(i: OrderItemRequest): i is PizzaItemRequest {
  return i.type === 'pizza';
}
