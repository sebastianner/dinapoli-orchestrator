import { create } from 'zustand';
import { setSessionExpiredHandler } from '@/lib/api';
import type { Employee } from '@/types/api';

const STORAGE_KEY = 'dinapoli:employee';

function storedEmployee(): Employee | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Employee;
  } catch {
    return null;
  }
}

interface SessionState {
  employee: Employee | null;
  setEmployee: (employee: Employee | null) => void;
  /**
   * True for exactly one render right after a deliberate employee selection
   * (select-employee.tsx), so __root.tsx can play the push-in-right unlock
   * transition only for that action - not on every remount of the app shell
   * (e.g. a plain page refresh while already logged in). consumeJustSelected
   * reads and resets it atomically so it can't accidentally fire twice.
   */
  justSelected: boolean;
  markJustSelected: () => void;
  consumeJustSelected: () => boolean;
}

// The stored employee is only a paint cache to avoid a flash of "logged out"
// on refresh - the httpOnly cookie session is the actual source of truth,
// hydrated (and corrected, if stale/wrong) via fetchCurrentSession() in
// __root.tsx.
export const useSessionStore = create<SessionState>((set, get) => ({
  employee: storedEmployee(),
  setEmployee: (employee) => {
    if (employee) localStorage.setItem(STORAGE_KEY, JSON.stringify(employee));
    else localStorage.removeItem(STORAGE_KEY);
    set({ employee });
  },
  justSelected: false,
  markJustSelected: () => set({ justSelected: true }),
  consumeJustSelected: () => {
    const value = get().justSelected;
    if (value) set({ justSelected: false });
    return value;
  },
}));

// A 401 that survives a refresh attempt means the session is truly over
// (revoked, expired, or the employee was deactivated) - clear the cached
// employee so the UI reflects it instead of showing a stale logged-in state.
setSessionExpiredHandler(() => useSessionStore.getState().setEmployee(null));
