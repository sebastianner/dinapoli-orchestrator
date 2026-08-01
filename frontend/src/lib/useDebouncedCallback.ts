import { useCallback, useRef } from 'react';

/**
 * Wraps a callback so calls within `delayMs` of the last one are ignored -
 * leading-edge (the first click fires immediately, same as an undebounced
 * handler), only rapid repeats afterward are swallowed. For guarding buttons
 * that trigger a real-world side effect (e.g. a physical print) against an
 * impatient double/triple-click firing it more than once - see every reprint
 * button (order history, order detail, closing reports).
 */
export function useDebouncedCallback<Args extends unknown[]>(callback: (...args: Args) => void, delayMs = 1500): (...args: Args) => void {
  const lastCallRef = useRef(0);

  return useCallback(
    (...args: Args) => {
      const now = Date.now();
      if (now - lastCallRef.current < delayMs) return;
      lastCallRef.current = now;
      callback(...args);
    },
    [callback, delayMs],
  );
}
