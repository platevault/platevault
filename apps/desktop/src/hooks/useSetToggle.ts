// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useSetToggle -- manages a Set<T> with toggle and clear operations.
 *
 * Replaces 6 copy-pasted set-toggle patterns across list components.
 * Returns a tuple of [set, toggle, clear].
 */

import { useState, useCallback } from 'react';

export function useSetToggle<T>(
  initial?: Iterable<T>,
): [Set<T>, (value: T) => void, () => void] {
  const [set, setSet] = useState<Set<T>>(() => new Set(initial));

  const toggle = useCallback((value: T) => {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSet(new Set());
  }, []);

  return [set, toggle, clear];
}
