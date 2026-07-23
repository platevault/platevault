// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Log ring buffer and subscription store (spec 019).
 *
 * Manages a 500-entry FIFO ring buffer of LogEntry items fed by:
 * 1. `logSubscription.ts` — live backend stream via `log:entry` Tauri events.
 * 2. `log.recent` command — initial hydration on first subscribe.
 *
 * Architecture:
 * - `appendLog(entries)` dedupes by `id` and evicts oldest when over capacity.
 * - `useLog()` hook returns the current buffer snapshot.
 * - `dropped` counts total evicted entries since session start (diagnostics only).
 * - Ring buffer ordering is newest-first for render (reverse of wire order).
 */

type Listener = () => void;

export const LOG_BUFFER_SIZE = 500;

/** Severity level (matches spec 019 LogEntry schema). */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** Source tag (matches spec 019 LogEntry schema). */
export type LogEntrySource =
  | 'audit'
  | 'diagnostic'
  | 'catalog'
  | 'plan'
  | 'workflow'
  | 'lifecycle'
  | 'inventory'
  | 'settings'
  | 'project'
  | 'target'
  | 'tool';

/** A projected log entry from the backend (matches spec 019 data-model.md). */
export interface LogEntry {
  id: string;
  contractVersion: string;
  time: string;
  level: LogLevel;
  source: LogEntrySource;
  message: string;
  requestId?: string;
  entityType?: string;
  entityId?: string;
}

interface LogBufferState {
  /** Entries in newest-first order for render. */
  entries: LogEntry[];
  /** Total entries evicted since session start. */
  dropped: number;
  /** True when the stream reported a history gap (truncated cursor). */
  truncated: boolean;
  truncatedCount?: number;
}

// ── Internal state ────────────────────────────────────────────────────────────

let state: LogBufferState = {
  entries: [],
  dropped: 0,
  truncated: false,
};

const listeners = new Set<Listener>();
// Fast dedup set on entry ids.
const seenIds = new Set<string>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Append one or more log entries to the ring buffer.
 *
 * - Dedupes by `id` so reconnect replay does not produce duplicate rows.
 * - Entries arrive oldest-first from the backend; we prepend to keep the
 *   buffer newest-first for render.
 * - Evicts oldest entries (from the tail of the array, i.e. the oldest)
 *   when `capacity` is exceeded.
 */
export function appendLog(newEntries: LogEntry[]): void {
  if (newEntries.length === 0) return;

  const toAdd = newEntries.filter((e) => !seenIds.has(e.id));
  if (toAdd.length === 0) return;

  for (const e of toAdd) seenIds.add(e.id);

  // Prepend new entries (newest-first render).
  const combined = [...toAdd.reverse(), ...state.entries];

  // Evict from tail (oldest) when over capacity.
  let dropped = state.dropped;
  let trimmed = combined;
  if (combined.length > LOG_BUFFER_SIZE) {
    const excess = combined.length - LOG_BUFFER_SIZE;
    dropped += excess;
    trimmed = combined.slice(0, LOG_BUFFER_SIZE);
    // Remove evicted ids from dedup set.
    for (const evicted of combined.slice(LOG_BUFFER_SIZE)) {
      seenIds.delete(evicted.id);
    }
  }

  state = { ...state, entries: trimmed, dropped };
  notify();
}

/** Mark the stream as truncated (history gap). */
export function markTruncated(count?: number): void {
  state = { ...state, truncated: true, truncatedCount: count };
  notify();
}

/** Return the current buffer snapshot. */
export function getLogSnapshot(): LogBufferState {
  return state;
}

/** Subscribe to buffer changes. Returns an unsubscribe function. */
export function subscribeLog(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reset the buffer (used in tests). */
export function resetLogStore(): void {
  state = { entries: [], dropped: 0, truncated: false };
  seenIds.clear();
  listeners.clear();
}
