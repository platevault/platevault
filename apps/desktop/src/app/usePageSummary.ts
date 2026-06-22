/**
 * Per-page status-bar summary (task #80).
 *
 * The top-bar convention drops per-page titles + counts (the left nav already
 * names the page); the count/metadata moves to the BOTTOM status bar. This tiny
 * external store is the channel: a list page calls `usePageSummary(text)` to
 * publish its count/metadata line on mount/update and clears it on unmount; the
 * global `StatusBar` subscribes via `usePageSummaryValue()` and renders it on
 * the left.
 *
 * An external `useSyncExternalStore`-backed store (rather than a React context)
 * is used deliberately: the page and the StatusBar are SIBLINGS under the shell
 * (`<Outlet/>` next to `<StatusBar/>`), so no single provider naturally wraps
 * both without restructuring the shell. A module-level store sidesteps that and
 * keeps the wiring to one `useEffect` per page.
 */

import { useEffect, useSyncExternalStore } from 'react';

let summary: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Publish (or clear, with `null`) the active page summary. */
export function setPageSummary(next: string | null): void {
  if (summary === next) return;
  summary = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | null {
  return summary;
}

/**
 * Read the active page summary. Used by the global StatusBar.
 * Returns `null` when no page has published one.
 */
export function usePageSummaryValue(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Publish `text` as the page summary for the lifetime of the calling component.
 * Clears the summary on unmount so a stale count never lingers under another
 * page. Pass `null` (or empty) while data is still loading to show nothing.
 */
export function usePageSummary(text: string | null): void {
  useEffect(() => {
    setPageSummary(text && text.length > 0 ? text : null);
    return () => setPageSummary(null);
  }, [text]);
}
