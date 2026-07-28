import { useEffect, useState } from 'react';

/** Delays reacting to a fast-changing value (e.g. a search input) until it's stopped changing for `delayMs` - keeps typing from firing a request per keystroke. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
