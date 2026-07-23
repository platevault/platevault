// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PageStatusContext — page-contextual status bar segment.
 *
 * Pages that want to surface contextual information in the bottom status bar
 * set a ReactNode via `useSetPageStatus` on mount and clear it on unmount.
 * `StatusBar` reads the node via `usePageStatus` and renders it in a
 * CENTER-LEFT slot when present, without displacing the global library totals.
 *
 * Only one page populates this at a time (Inbox); all other pages leave it
 * null so the status bar falls back to its global-only layout.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';

// ── Context ───────────────────────────────────────────────────────────────────

interface PageStatusValue {
  /** The page-supplied status node, or null when no page has set one. */
  node: ReactNode;
  /** Setter used by pages to populate or clear the slot. */
  setNode: (node: ReactNode) => void;
}

const PageStatusContext = createContext<PageStatusValue>({
  node: null,
  setNode: () => undefined,
});

// ── Provider ──────────────────────────────────────────────────────────────────

export function PageStatusProvider({ children }: { children: ReactNode }) {
  const [node, setNodeState] = useState<ReactNode>(null);

  const setNode = useCallback((n: ReactNode) => {
    setNodeState(n);
  }, []);

  const value = useMemo(() => ({ node, setNode }), [node, setNode]);

  return (
    <PageStatusContext.Provider value={value}>
      {children}
    </PageStatusContext.Provider>
  );
}

// ── Consumer hook (StatusBar) ─────────────────────────────────────────────────

/** Returns the current page-contextual status node (null when not set). */
export function usePageStatus(): ReactNode {
  return useContext(PageStatusContext).node;
}

// ── Setter hook (pages) ───────────────────────────────────────────────────────

/**
 * Lets a page populate the status bar's contextual slot.
 *
 * Pass a ReactNode to set the slot; the slot is automatically cleared when
 * the calling component unmounts. Call with `null` to clear explicitly while
 * still mounted.
 *
 * Typical usage (top of page component):
 *
 *   useSetPageStatus(<InboxStatusSegment stats={derivedStats} />);
 *
 * The hook re-runs the effect whenever `node` changes identity so dynamic
 * content (e.g. updated counts in a new JSX element) propagates to the bar.
 */
export function useSetPageStatus(node: ReactNode): void {
  const { setNode } = useContext(PageStatusContext);

  useEffect(() => {
    setNode(node);
    return () => {
      setNode(null);
    };
    // Re-run whenever `node` changes so the status bar reflects updated content.
    // `setNode` is stable (useCallback with no deps) so it is safe to include.
  }, [node, setNode]);
}
