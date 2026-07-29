import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Tracks a container element's actual rendered pixel width via
 * ResizeObserver, so a chart's SVG viewBox can exactly match its real box
 * instead of being fit/letterboxed into it via preserveAspectRatio tricks -
 * that approach (a fixed-aspect viewBox scaled to fit a wider card) is what
 * made the D3 charts render small with empty space on either side.
 */
export function useMeasuredWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
