import { useEffect, useRef } from 'react';

/**
 * Focuses the referenced element on mount for keyboard accessibility.
 * Used on page headings or first interactive elements after route transitions
 * to ensure keyboard and screen-reader users land in a predictable location.
 */
export function useFocusOnMount<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    // Use requestAnimationFrame to wait for the element to be rendered
    const raf = requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return ref;
}
