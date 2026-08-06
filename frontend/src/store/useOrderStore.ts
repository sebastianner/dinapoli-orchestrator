import { create } from 'zustand';
import type { Order, OrderItemRequest, OrderType, PromoSettings, PromoType } from '@/types/api';
import { applyPromoPricingPreview, freeBreadRequest, PROMO_ITEM_COUNTS } from '@/lib/promos';
import { randomUUID } from '@/lib/uuid';

/** Cached at draft-start time (see startDraft) purely for display in the Order Overview panel, so it doesn't need an extra fetch - only customerId/customerAddressId are ever sent to the server. */
export interface CustomerDisplayInfo {
  name: string;
  phone: string | null;
  /** Formatted delivery address, delivery orders only. */
  address: string | null;
}

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

/** Items collected so far toward an in-progress promo, staged separately from `cart` until complete (see startPromo/addPromoItem). */
export interface PromoDraft {
  type: PromoType;
  items: CartItem[];
}

/** Metadata for an order that doesn't exist on the server yet. */
export interface NewOrderInfo {
  orderType: OrderType;
  tableNumber?: number;
  customerId?: number;
  customerAddressId?: number;
  customerDisplay?: CustomerDisplayInfo;
}

interface OrderState {
  /** Orders fetched from the API (GET /api/orders?status=ACTIVE), kept in sync via WS/refetch. */
  activeOrders: Order[];
  setActiveOrders: (orders: Order[]) => void;
  upsertActiveOrder: (order: Order) => void;
  /** For an order deleted server-side (see LiveOrderUpdates - a 404 on refetch after 'order_updated' means it's gone, not stale). */
  removeActiveOrder: (orderId: number) => void;

  /** Set once the order being worked on already exists on the server. Mutually exclusive with `newOrderInfo`. */
  currentOrderId: number | null;
  /** Set while building an order that hasn't been submitted yet. */
  newOrderInfo: NewOrderInfo | null;
  /** Items staged in the Menu/Order Overview flow, for either a new or an existing order. */
  cart: CartItem[];

  /**
   * Draft tip/delivery fee/discount for the order currently open in the
   * Order Overview panel - purely client-side. The server has nowhere to
   * store these before a payment method is chosen (see order_payments), so
   * they're only ever sent once, as part of the `payments` array at
   * POST /orders/:id/complete. Reset whenever the open order changes.
   */
  pendingTip: number;
  pendingDeliveryFee: number;
  pendingDiscount: number;

  /** Set while the user is actively picking items for a promo (see the Promos page). Cleared automatically once the required item count is reached and finalized into `cart`. */
  promoDraft: PromoDraft | null;
  /**
   * One entry per promo whose items have already been finalized into `cart`
   * - an order can carry several (e.g. a 'duo' and a 'pizza_xl' together).
   * Array order matches each promo's group index, which is what the
   * finalized cart items were tagged with (see addPromoItem) - carried
   * through to the server on submit as OrderRequest.promos so it can
   * validate/flat-price each one. Reset whenever the open order changes,
   * same as pendingTip etc.
   */
  finalizedPromos: PromoType[];

  startDraft: (input: NewOrderInfo) => void;
  /** Attaches a customer to the in-progress draft (see CustomerInfoModal, invoked from OrderOverview for dine_in). No-op if there's no draft to attach to. */
  setDraftCustomer: (customerId: number, customerAddressId: number | undefined, display: CustomerDisplayInfo) => void;
  openExistingOrder: (orderId: number) => void;
  /** Like openExistingOrder, but for a draft that just got submitted and became this same order - keeps pendingTip/DeliveryFee/Discount instead of resetting them. */
  promoteDraftToOrder: (orderId: number) => void;
  addCartItem: (item: CartItem) => void;
  removeCartItem: (clientId: string) => void;
  removeCartItems: (clientIds: string[]) => void;
  clearCart: () => void;
  clearCurrentOrder: () => void;
  setPendingTip: (tip: number) => void;
  setPendingDeliveryFee: (deliveryFee: number) => void;
  setPendingDiscount: (discount: number) => void;
  /** Starts a promo draft; 'pizza_xl' auto-adds its free bread since there's no choice to make for it. */
  startPromo: (type: PromoType) => void;
  /** Adds one item toward the active promo draft; once it reaches the promo's required count, prices it (preview only, using the passed-in current settings) and finalizes it into `cart` automatically. No-op if no promo is active. */
  addPromoItem: (item: CartItem, settings: PromoSettings) => void;
  cancelPromo: () => void;
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
  removeActiveOrder: (orderId) => set((state) => ({ activeOrders: state.activeOrders.filter((o) => o.id !== orderId) })),

  currentOrderId: null,
  newOrderInfo: null,
  cart: [],
  pendingTip: 0,
  pendingDeliveryFee: 0,
  pendingDiscount: 0,
  promoDraft: null,
  finalizedPromos: [],

  // Doesn't clear `cart` - a table/delivery/takeaway can be picked *after*
  // items were already added (see ProductCard etc., which no longer require
  // an order context to add to cart), and those items should carry into the
  // draft being started rather than get silently wiped.
  startDraft: (info) =>
    set({ currentOrderId: null, newOrderInfo: info, pendingTip: 0, pendingDeliveryFee: 0, pendingDiscount: 0, promoDraft: null, finalizedPromos: [] }),
  setDraftCustomer: (customerId, customerAddressId, display) =>
    set((state) => (state.newOrderInfo ? { newOrderInfo: { ...state.newOrderInfo, customerId, customerAddressId, customerDisplay: display } } : state)),
  openExistingOrder: (orderId) =>
    set({
      currentOrderId: orderId,
      newOrderInfo: null,
      cart: [],
      pendingTip: 0,
      pendingDeliveryFee: 0,
      pendingDiscount: 0,
      promoDraft: null,
      finalizedPromos: [],
    }),
  promoteDraftToOrder: (orderId) => set({ currentOrderId: orderId, newOrderInfo: null, cart: [], finalizedPromos: [] }),
  addCartItem: (item) => set((state) => ({ cart: [...state.cart, item] })),
  removeCartItem: (clientId) => set((state) => ({ cart: state.cart.filter((i) => i.clientId !== clientId) })),
  removeCartItems: (clientIds) =>
    set((state) => {
      const ids = new Set(clientIds);
      return { cart: state.cart.filter((i) => !ids.has(i.clientId)) };
    }),
  clearCart: () => set({ cart: [] }),
  clearCurrentOrder: () =>
    set({ currentOrderId: null, newOrderInfo: null, cart: [], pendingTip: 0, pendingDeliveryFee: 0, pendingDiscount: 0, promoDraft: null, finalizedPromos: [] }),
  setPendingTip: (tip) => set({ pendingTip: tip }),
  setPendingDeliveryFee: (deliveryFee) => set({ pendingDeliveryFee: deliveryFee }),
  setPendingDiscount: (discount) => set({ pendingDiscount: discount }),

  startPromo: (type) =>
    set({
      promoDraft: {
        type,
        items:
          type === 'pizza_xl'
            ? [{ clientId: randomUUID(), request: freeBreadRequest(), label: 'Panes al Gratín (promo, gratis)', unitPrice: 0, quantity: 1 }]
            : [],
      },
    }),
  addPromoItem: (item, settings) =>
    set((state) => {
      if (!state.promoDraft) return state;
      const items = [...state.promoDraft.items, item];
      if (items.length < PROMO_ITEM_COUNTS[state.promoDraft.type]) {
        return { promoDraft: { ...state.promoDraft, items } };
      }
      // This promo's group index is however many are already finalized -
      // matches the index the client tags these items with (see
      // applyPromoPricingPreview) and the position OrderRequest.promos will
      // submit this promo's type at.
      const priced = applyPromoPricingPreview(state.promoDraft.type, items, settings, state.finalizedPromos.length);
      return { promoDraft: null, finalizedPromos: [...state.finalizedPromos, state.promoDraft.type], cart: [...state.cart, ...priced] };
    }),
  cancelPromo: () => set({ promoDraft: null }),
}));
