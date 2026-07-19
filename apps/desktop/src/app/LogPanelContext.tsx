// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LogPanel context (spec 019).
 *
 * Provides:
 * - `expanded` / `toggle` — panel open/close state.
 * - `logLevel` — current `logLevel` settings key (gates diagnostic visibility).
 * - `followLogs` / `setFollowLogs` — persisted follow-tail preference (via
 *   `rememberFollowLogs` settings key from spec 018).
 * - `levelFilter` / `setLevelFilter` — session-only UI level filter.
 * - `sourceFilter` / `setSourceFilter` — session-only source filter (empty = all).
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { LogLevel, LogEntrySource } from '@/data/logStore';

export type LevelFilter = 'all' | LogLevel;

// Persisted directly in localStorage (not routed through the generated
// AppPreferences contract, which is backed by a Rust struct + settings IPC)
// — same lightweight pattern useAdaptiveDock.ts uses for its own UI-only
// persisted state. Journey 16 groups this with sidebar-collapse persistence
// as a "persistent layout choice" that survives restart (#842).
const EXPANDED_STORAGE_KEY = 'alm-log-panel-expanded';

function readStoredExpanded(): boolean {
  try {
    return window.localStorage.getItem(EXPANDED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredExpanded(value: boolean): void {
  try {
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, String(value));
  } catch {
    // Storage full or unavailable; state stays in-memory for this session.
  }
}

interface LogPanelState {
  expanded: boolean;
  toggle: () => void;
  /** Global log level from settings (gates diagnostic visibility). */
  logLevel: LogLevel;
  /** Follow-tail preference (persisted). */
  followLogs: boolean;
  setFollowLogs: (v: boolean) => void;
  /** Session-only level filter chip. Resets to 'all' on each panel open. */
  levelFilter: LevelFilter;
  setLevelFilter: (v: LevelFilter) => void;
  /** Session-only source filter. Empty array = all sources. */
  sourceFilter: LogEntrySource[];
  setSourceFilter: (v: LogEntrySource[]) => void;
}

const LogPanelContext = createContext<LogPanelState>({
  expanded: false,
  toggle: () => {},
  logLevel: 'info',
  followLogs: false,
  setFollowLogs: () => {},
  levelFilter: 'all',
  setLevelFilter: () => {},
  sourceFilter: [],
  setSourceFilter: () => {},
});

export function LogPanelProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(readStoredExpanded);
  const [logLevel, setLogLevel] = useState<LogLevel>('info');
  const [followLogs, setFollowLogsState] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<LogEntrySource[]>([]);

  // Set once the user explicitly toggles follow-tail, so the async load below
  // can never overwrite a deliberate choice.
  const followTouchedRef = useRef(false);

  // Load persisted settings on mount (T012, T032).
  //
  // This resolves asynchronously, so it can land AFTER the user has already
  // interacted: open the panel on a slow machine, hit Follow, and the in-flight
  // read arrives a moment later and flips it straight back. The click is the
  // more recent intent and must win — a late read of the very setting the user
  // just changed is stale by definition.
  //
  // Surfaced as a Windows-only CI failure in LogPanel.followScroll.test.tsx
  // ("expected '↓ Follow' to be '— Follow'"): the loaded `true` clobbered the
  // test's toggle-off whenever the loaded runner resolved the promise late
  // enough. The flakiness was the symptom; this race is the defect.
  useEffect(() => {
    commands
      .settingsGet('advanced')
      .then(unwrap)
      .then((data) => {
        const vals = data.values as Record<string, unknown>;
        if (vals?.logLevel && typeof vals.logLevel === 'string') {
          setLogLevel(vals.logLevel as LogLevel);
        }
        if (
          typeof vals?.rememberFollowLogs === 'boolean' &&
          !followTouchedRef.current
        ) {
          setFollowLogsState(vals.rememberFollowLogs);
        }
      })
      .catch(() => {
        // Non-fatal; fall back to defaults.
      });
  }, []);

  const toggle = useCallback(() => {
    setExpanded((v) => {
      const next = !v;
      // Reset level filter to 'all' on each open (per spec research R7).
      if (next) {
        setLevelFilter('all');
      }
      writeStoredExpanded(next);
      return next;
    });
  }, []);

  const setFollowLogs = useCallback((v: boolean) => {
    // Claim the setting before the mount read can answer (see the effect
    // above) — from here on, the user owns it for this session.
    followTouchedRef.current = true;
    setFollowLogsState(v);
    // Persist via settings.update (spec 018).
    void commands
      .settingsUpdate('advanced', { rememberFollowLogs: v })
      .then(unwrap);
  }, []);

  return (
    <LogPanelContext.Provider
      value={{
        expanded,
        toggle,
        logLevel,
        followLogs,
        setFollowLogs,
        levelFilter,
        setLevelFilter,
        sourceFilter,
        setSourceFilter,
      }}
    >
      {children}
    </LogPanelContext.Provider>
  );
}

export function useLogPanel() {
  return useContext(LogPanelContext);
}
