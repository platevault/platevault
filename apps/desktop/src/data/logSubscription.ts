/**
 * Log stream subscription (spec 019, T020).
 *
 * Subscribes to the backend log stream in two ways:
 * 1. Initial hydration: calls `log.recent` on first mount to populate the ring
 *    buffer with the most recent 500 entries.
 * 2. Live updates: listens for `log:entry` Tauri events forwarded by the
 *    backend bus→Tauri forwarder.
 *
 * Deduplication is handled by `appendLog` in `logStore.ts`.
 *
 * In mock/test mode (VITE_USE_MOCKS=true) the Tauri listen API is unavailable;
 * the subscription is a no-op and the mock invoker seeds the initial entries.
 */

import { appendLog, getLogSnapshot, markTruncated, type LogEntry } from './logStore';

const IS_MOCK = import.meta.env.VITE_USE_MOCKS === 'true';

let unlisten: (() => void) | null = null;
let subscribed = false;

// ── Recent entries pull ───────────────────────────────────────────────────────

async function fetchRecentEntries(cursor?: string): Promise<void> {
  try {
    // Conditionally import based on mock mode.
    if (IS_MOCK) {
      // In mock mode, seed with a few placeholder entries.
      const { MOCK_LOG_ENTRIES } = await import('./mockLogEntries');
      appendLog(MOCK_LOG_ENTRIES);
      return;
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const response = await invoke<{
      contractVersion: string;
      entries: LogEntry[];
      truncated?: boolean;
      truncatedCount?: number;
    }>('log.recent', {
      cursor,
      levelMin: null,
      includeDiagnostics: true,
      sourceFilter: null,
      windowSize: 500,
    });

    if (response.truncated) {
      markTruncated(response.truncatedCount ?? undefined);
    }
    if (response.entries.length > 0) {
      appendLog(response.entries);
    }
  } catch (err) {
    // Non-fatal: the log panel shows whatever is in the buffer.
    console.warn('[logSubscription] fetchRecentEntries failed:', err);
  }
}

// ── Live event listener ───────────────────────────────────────────────────────

async function startLiveListener(): Promise<void> {
  if (IS_MOCK) return;

  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlistenFn = await listen<LogEntry>('log:entry', (event) => {
      appendLog([event.payload]);
    });
    unlisten = unlistenFn;
  } catch (err) {
    console.warn('[logSubscription] listen failed:', err);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the log subscription (idempotent).
 *
 * On first call: fetches the initial window, then starts the live listener.
 * On subsequent calls: no-op (dedup handles reconnect replay).
 */
export async function startLogSubscription(): Promise<void> {
  if (subscribed) return;
  subscribed = true;

  // Get the most recent cursor from the current buffer to resume from.
  // Entries are newest-first; we prefer the latest aud: entry as cursor because
  // dia: (diagnostic) entries are in-memory only and have no DB row to resume from.
  // Without this, a dia: entry as the last seen causes a full replay (T062 FR-025).
  const snapshot = getLogSnapshot();
  const audEntry = snapshot.entries.find((e) => e.id.startsWith('aud:'));
  const cursor = audEntry?.id;

  await fetchRecentEntries(cursor);
  await startLiveListener();
}

/**
 * Stop the live listener and reset subscription state.
 *
 * Does NOT clear the ring buffer — entries remain visible after reconnect
 * until they are naturally evicted.
 */
export function stopLogSubscription(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
  subscribed = false;
}
