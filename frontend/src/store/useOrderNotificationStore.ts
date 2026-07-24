import { create } from 'zustand';

export type OrderNotificationKind = 'created' | 'closed';

interface OrderNotificationState {
  kind: OrderNotificationKind | null;
  show: (kind: OrderNotificationKind) => void;
}

let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** Drives the brief full-screen confirmation shown when an order is sent or closed - see OrderNotification. */
export const useOrderNotificationStore = create<OrderNotificationState>((set) => ({
  kind: null,
  show: (kind) => {
    clearTimeout(hideTimer);
    set({ kind });
    hideTimer = setTimeout(() => set({ kind: null }), 2200);
  },
}));
