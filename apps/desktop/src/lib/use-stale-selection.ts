// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Spec 020 — Router & URL State (desktop rescope), US3 stale-id fallback.
//
// When a ledger route carries `?selected=<id>` but the entity is missing
// (deleted/archived/never present), clear `selected` from the URL exactly once
// via `replace`, preserving the other params. `clear` is supplied by the page
// (so the hook stays router-agnostic and testable); it should perform a
// `navigate({ search: prev => ({ ...prev, selected: undefined }), replace: true })`.

import { useEffect, useRef } from 'react';

export function useStaleSelectionCleanup<T extends string | number>(
  selected: T | undefined,
  found: boolean,
  clear: () => void,
): void {
  const clearedFor = useRef<T | undefined>(undefined);

  useEffect(() => {
    if (selected === undefined) {
      clearedFor.current = undefined;
      return;
    }
    if (!found && clearedFor.current !== selected) {
      clearedFor.current = selected;
      clear();
    }
  }, [selected, found, clear]);
}
