// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { useRef, useCallback, useState } from 'react';
import { updateSettings } from './settingsIpc';

/**
 * Auto-save hook with 300ms debounce.
 * Each pane calls `save(scope, values)` on change.
 * Exposes a `saved` flag that resets after 1.5s for UI feedback.
 */
export function useAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useCallback((scope: string, values: Record<string, unknown>) => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      await updateSettings({ scope, values });
      setSaved(true);

      if (feedbackRef.current) clearTimeout(feedbackRef.current);
      feedbackRef.current = setTimeout(() => setSaved(false), 1500);
    }, 300);
  }, []);

  return { save, saved };
}
