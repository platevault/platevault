// First-run gate for the index route (spec 020 T003/T052). Extracted so it is
// unit-testable without importing the whole router/Shell tree.

import { getPreferences, setPreference } from '@/data/preferences';

/**
 * Returns `true` when first-run setup is complete (index should land on the
 * app) and `false` when the index route must redirect to `/setup`. Prefers the
 * Tauri `firstrun_state` command when running natively; falls back to the
 * persisted preference (and in mock mode uses it directly).
 */
export async function checkFirstRunComplete(): Promise<boolean> {
  const prefs = getPreferences();

  const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';
  if (useMocks) return !!prefs.setupCompleted;

  // The DB is the source of truth; localStorage `setupCompleted` is only a cache.
  // We always consult the backend (fast local query) and reconcile the cache to
  // it, so a stale/cleared cache can't disagree with the DB. A previous
  // short-circuit (`if (prefs.setupCompleted) return true`) plus the Shell's
  // cache-only guard let the two diverge and caused a /→/setup redirect loop.
  try {
    const { commands } = await import('@/bindings/index');
    const result = await commands.firstrunState();
    if (result.status === 'ok') {
      // `completedAt` is optional in the serialized response (omitted when null),
      // so it can be `undefined` *or* `null` when incomplete — treat both as not done.
      const complete = Boolean(result.data.completedAt);
      if (prefs.setupCompleted !== complete) {
        setPreference('setupCompleted', complete);
      }
      return complete;
    }
    // Backend unavailable: fall back to the cache.
    return !!prefs.setupCompleted;
  } catch {
    return !!prefs.setupCompleted;
  }
}
