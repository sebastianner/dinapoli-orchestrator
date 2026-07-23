import { create } from 'zustand';

const STORAGE_KEY = 'dinapoli:avatar-overrides';

function loadOverrides(): Record<number, string> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<number, string>;
  } catch {
    return {};
  }
}

interface AvatarOverrideState {
  overrides: Record<number, string>;
  setOverride: (employeeId: number, seed: string) => void;
}

/**
 * "Editing" an employee's avatar is client-only: the backend only exposes
 * add + soft-delete for employees, no update endpoint. The chosen DiceBear
 * seed is kept per-browser instead of synced server-side.
 */
export const useAvatarOverrideStore = create<AvatarOverrideState>((set, get) => ({
  overrides: loadOverrides(),
  setOverride: (employeeId, seed) => {
    const overrides = { ...get().overrides, [employeeId]: seed };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    set({ overrides });
  },
}));
