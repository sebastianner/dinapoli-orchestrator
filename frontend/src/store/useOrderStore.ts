import { create } from 'zustand';
import type { CustomerInfo, Order, OrderItemRequest, OrderType } from '@/types/api';

/** A menu item staged in the Order Overview, not yet sent to the server. */
export interface CartItem {
  /** Client-only id, used to remove a line before it's committed. */
  clientId: string;
  request: OrderItemRequest;
  /** Display label for the Order Overview, e.g. "Pizza XL - Hawaiana, Pepperoni". */
  label: string;
  /** Resolved from the menu client-side so the overview can show a running subtotal; the
   * server always recomputes the authoritative price on submission (see resolveItems). */
  unitPrice: number;
  quantity: number;
}

/** Metadata for an order that doesn't exist on the server yet. */
export interface NewOrderInfo {
  orderType: OrderType;
  tableNumber?: number;
  customer?: CustomerInfo;
}

interface OrderState {
  /** Orders fetched from the API (GET /api/orders?status=ACTIVE), kept in sync via WS/refetch. */
  activeOrders: Order[];
  setActiveOrders: (orders: Order[]) => void;
  upsertActiveOrder: (order: Order) => void;

  /** Set once the order being worked on already exists on the server. Mutually exclusive with `newOrderInfo`. */
  currentOrderId: number | null;
  /** Set while building an order that hasn't been submitted yet. */
  newOrderInfo: NewOrderInfo | null;
  /** Items staged in the Menu/Order Overview flow, for either a new or an existing order. */
  cart: CartItem[];

  startDraft: (input: NewOrderInfo) => void;
  openExistingOrder: (orderId: number) => void;
  addCartItem: (item: CartItem) => void;
  removeCartItem: (clientId: string) => void;
  clearCart: () => void;
  clearCurrentOrder: () => void;
}

export const useOrderStore = create<OrderState>((set) => ({
  activeOrders: [],
  setActiveOrders: (orders) => set({ activeOrders: orders }),
  upsertActiveOrder: (order) =>
    set((state) => {
      const isStillActive = order.status !== 'COMPLETED';
      const withoutOrder = state.activeOrders.filter((o) => o.id !== order.id);
      return { activeOrders: isStillActive ? [...withoutOrder, order] : withoutOrder };
    }),

  currentOrderId: null,
  newOrderInfo: null,
  cart: [],

  startDraft: (info) => set({ currentOrderId: null, newOrderInfo: info, cart: [] }),
  openExistingOrder: (orderId) => set({ currentOrderId: orderId, newOrderInfo: null, cart: [] }),
  addCartItem: (item) => set((state) => ({ cart: [...state.cart, item] })),
  removeCartItem: (clientId) => set((state) => ({ cart: state.cart.filter((i) => i.clientId !== clientId) })),
  clearCart: () => set({ cart: [] }),
  clearCurrentOrder: () => set({ currentOrderId: null, newOrderInfo: null, cart: [] }),
}));
