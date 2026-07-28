export interface TablePosition {
  /** Percent of the floor container's width/height, 0-100 - stays valid across viewport sizes and container resizes, unlike pixel coordinates. */
  xPct: number;
  yPct: number;
}

const STORAGE_KEY = 'dinapoli:tablePositions';

/** No auth/backend involved - purely a per-device display preference, so localStorage is enough. */
export function loadTablePositions(): Record<number, TablePosition> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<number, TablePosition>) : {};
  } catch {
    return {};
  }
}

export function saveTablePosition(tableNumber: number, position: TablePosition): void {
  const all = loadTablePositions();
  all[tableNumber] = position;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/** Even wrapping-grid layout for a table with no saved position yet, so a newly added table always starts somewhere sensible instead of stacked at 0,0. */
export function defaultTablePosition(tableNumber: number, totalTables: number): TablePosition {
  const cols = Math.max(1, Math.ceil(Math.sqrt(totalTables)));
  const rows = Math.max(1, Math.ceil(totalTables / cols));
  const index = tableNumber - 1;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    xPct: ((col + 0.5) / cols) * 100,
    // Capped well short of 100 so the bottom row doesn't crowd the
    // Domicilio/Para llevar chips anchored near the bottom of the floor.
    yPct: 18 + (row / Math.max(1, rows - 1 || 1)) * 54,
  };
}
