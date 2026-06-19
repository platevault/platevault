// First-run gate for the index route (spec 020 T003/T052). Extracted so it is
// unit-testable without importing the whole router/Shell tree.

import { getPreferences } from '@/data/preferences';

/**
 * Returns `true` when first-run setup is complete (index should land on the
 * app) and `false` when the index route must redirect to `/setup`. Prefers the
 * Tauri `firstrun_state` command when running natively; falls back to the
 * persisted preference (and in mock mode uses it directly).
 */
export async function checkFirstRunComplete(): Promise<boolean> {
  const prefs = getPreferences();
  if (prefs.setupCompleted) return true;

  const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';
  if (useMocks) return !!prefs.setupCompleted;

  try {
    const { commands } = await import('@/bindings/index');
    const result = await commands.firstrunState();
    // `completedAt` is optional in the serialized response (omitted when null),
    // so it can be `undefined` *or* `null` when incomplete — treat both as not done.
    if (result.status === 'ok') return Boolean(result.data.completedAt);
    return !!prefs.setupCompleted;
  } catch {
    return !!prefs.setupCompleted;
  }
}
