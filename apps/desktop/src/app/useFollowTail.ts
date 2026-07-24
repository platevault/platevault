// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Follow-tail scroll behaviour for the log panel virtualizer.
 *
 * Extracted from LogPanel to isolate the scroll-lock/pause state machine from
 * the rendering logic.
 */

import { useEffect, useCallback, useState } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';

export interface UseFollowTailOptions {
  /** Whether the log panel is currently expanded/visible. */
  expanded: boolean;
  /** User preference for following new entries. */
  followLogs: boolean;
  /** Setter for the persisted follow preference. */
  setFollowLogs: (v: boolean) => void;
  /** Number of visible entries (drives the re-scroll trigger). */
  entryCount: number;
  /** The virtualizer instance to scroll. */
  virtualizer: Virtualizer<HTMLUListElement, Element>;
  /** Ref to the scroll container element. */
  listRef: React.RefObject<HTMLUListElement | null>;
  /** Reduced-motion preference. */
  prefersReducedMotion: boolean;
}

export interface UseFollowTailReturn {
  /** Whether follow is temporarily paused by manual scroll-up. */
  scrollPaused: boolean;
  /** Scroll event handler to attach to the scroll container. */
  handleScroll: () => void;
  /** Toggle follow (also resets scroll pause when re-enabling). */
  toggleFollow: () => void;
}

export function useFollowTail({
  expanded,
  followLogs,
  setFollowLogs,
  entryCount,
  virtualizer,
  listRef,
  prefersReducedMotion,
}: UseFollowTailOptions): UseFollowTailReturn {
  // Temporary scroll-up pause (does not mutate persisted preference).
  const [scrollPaused, setScrollPaused] = useState(false);

  // Follow-tail scroll.
  useEffect(() => {
    if (!expanded || !followLogs || scrollPaused) return;
    const list = listRef.current;
    if (!list) return;
    // Entries are newest-first: scroll to top (offset 0) to see the latest.
    // Drive the virtualizer to index 0 so its window updates, then pin the
    // native scrollTop to 0 (covers reduced-motion + non-smooth fallbacks and
    // jsdom, where `scrollTo` is a no-op).
    virtualizer.scrollToIndex(0, { align: 'start' });
    if (prefersReducedMotion) {
      list.scrollTop = 0;
    } else {
      list.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [
    entryCount,
    expanded,
    followLogs,
    scrollPaused,
    prefersReducedMotion,
    virtualizer,
    listRef,
  ]);

  // Pause follow on manual scroll-up, resume on scroll-to-top.
  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    // If user scrolled away from top (top = newest), pause follow.
    if (list.scrollTop > 20) {
      setScrollPaused(true);
    } else {
      setScrollPaused(false);
    }
  }, [listRef]);

  // #832: re-enabling Follow must resume at the newest row even if a manual
  // scroll-up left `scrollPaused` set.
  const toggleFollow = useCallback(() => {
    const next = !followLogs;
    setFollowLogs(next);
    if (next) setScrollPaused(false);
  }, [followLogs, setFollowLogs]);

  return { scrollPaused, handleScroll, toggleFollow };
}
