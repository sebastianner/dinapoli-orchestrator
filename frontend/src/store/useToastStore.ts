import { create } from 'zustand';
import { randomUUID } from '@/lib/uuid';

export interface Toast {
  id: string;
  message: string;
  variant: 'success' | 'error' | 'warning';
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, variant?: Toast['variant']) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, variant = 'success') => {
    const id = randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, message, variant }] }));
    setTimeout(() => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })), 4000);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
