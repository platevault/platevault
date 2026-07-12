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
  type ReactNode,
} from 'react';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { LogLevel, LogEntrySource } from '@/data/logStore';

export type LevelFilter = 'all' | LogLevel;

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
  const [expanded, setExpanded] = useState(false);
  const [logLevel, setLogLevel] = useState<LogLevel>('info');
  const [followLogs, setFollowLogsState] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<LogEntrySource[]>([]);

  // Load persisted settings on mount (T012, T032).
  useEffect(() => {
    commands
      .settingsGet('advanced')
      .then(unwrap)
      .then((data) => {
        const vals = data.values as Record<string, unknown>;
        if (vals?.logLevel && typeof vals.logLevel === 'string') {
          setLogLevel(vals.logLevel as LogLevel);
        }
        if (typeof vals?.rememberFollowLogs === 'boolean') {
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
      return next;
    });
  }, []);

  const setFollowLogs = useCallback((v: boolean) => {
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
