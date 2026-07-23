import { create } from 'zustand';
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
}

export const useSessionStore = create<SessionState>((set) => ({
  employee: storedEmployee(),
  setEmployee: (employee) => {
    if (employee) localStorage.setItem(STORAGE_KEY, JSON.stringify(employee));
    else localStorage.removeItem(STORAGE_KEY);
    set({ employee });
  },
}));
