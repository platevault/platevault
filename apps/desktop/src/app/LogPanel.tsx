/**
 * Bottom log panel (spec 019).
 *
 * - Full-width fold-out driven by `LogPanelContext`.
 * - Level filter chips (session-only, resets to 'all' on open).
 * - Follow-tail toggle (persisted via `rememberFollowLogs` setting).
 * - Diagnostics toggle (gated by `logLevel === "debug"`).
 * - Cross-link: clicking a row with `entityType` + `entityId` navigates to
 *   the entity page; rows with only `requestId` navigate to the audit timeline.
 * - Export action in the panel header.
 * - Truncation marker when history gap is detected.
 * - Escape key closes the panel.
 */
import { useEffect, useRef, useCallback, useSyncExternalStore, useState } from 'react';
import { m } from '@/lib/i18n';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Collapsible } from '@base-ui-components/react/collapsible';
import { useNavigate } from '@tanstack/react-router';
import { useLogPanel } from './LogPanelContext';
import {
  subscribeLog,
  getLogSnapshot,
  type LogEntry,
  type LogLevel,
  type LogEntrySource,
} from '@/data/logStore';
import { startLogSubscription } from '@/data/logSubscription';
import { logExport } from '@/api/commands';
import type { LevelFilter } from './LogPanelContext';
import { errMessage } from '@/lib/errors';
import { formatTimeOfDay } from '@/lib/datetime';
import { useHotkeys } from '@/lib/useHotkeys';

// ── Level chip display helpers ────────────────────────────────────────────────

const LEVEL_CHIPS: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: m.log_level_all() },
  { value: 'error', label: m.settings_advanced_log_error() },
  { value: 'warn', label: m.settings_advanced_log_warn() },
  { value: 'info', label: m.settings_advanced_log_info() },
  { value: 'debug', label: m.settings_advanced_log_debug() },
];

function passesLevelFilter(entryLevel: LogLevel, filter: LevelFilter): boolean {
  if (filter === 'all') return true;
  return entryLevel === filter;
}

function passesSourceFilter(entrySource: LogEntrySource, filter: LogEntrySource[]): boolean {
  if (filter.length === 0) return true;
  return filter.includes(entrySource);
}


// ── Entity navigation helpers ─────────────────────────────────────────────────

type EntityNavigateFn = (entityType: string, entityId: string) => void;
type AuditNavigateFn = (requestId: string) => void;

function buildEntityPath(entityType: string, entityId: string): string {
  switch (entityType) {
    case 'plan':
      return `/plans/${entityId}`;
    case 'project':
      return `/projects/${entityId}`;
    case 'session':
      return `/sessions/${entityId}`;
    case 'target':
      return `/targets/${entityId}`;
    case 'catalog':
      return `/settings?tab=catalogs`;
    default:
      return `/audit?entityType=${entityType}&entityId=${entityId}`;
  }
}

// ── LogPanel component ────────────────────────────────────────────────────────

export function LogPanel() {
  const {
    expanded,
    toggle,
    logLevel,
    followLogs,
    setFollowLogs,
    levelFilter,
    setLevelFilter,
    sourceFilter,
  } = useLogPanel();

  const navigate = useNavigate();
  const listRef = useRef<HTMLUListElement>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Temporary scroll-up pause (does not mutate persisted preference).
  const [scrollPaused, setScrollPaused] = useState(false);

  // Reduced-motion preference.
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // Subscribe to the log ring buffer.
  const { entries, truncated, truncatedCount } = useSyncExternalStore(
    subscribeLog,
    getLogSnapshot,
  );

  // Filter entries for render (computed before the follow-tail effect /
  // virtualizer that depend on the rendered list).
  const visibleEntries = entries.filter((entry) => {
    if (!passesLevelFilter(entry.level, levelFilter)) return false;
    if (!passesSourceFilter(entry.source, sourceFilter)) return false;
    if (entry.source === 'diagnostic' && !showDiagnostics) return false;
    // Gate diagnostics on logLevel setting (A3).
    if (entry.source === 'diagnostic' && logLevel !== 'debug') return false;
    return true;
  });

  // Idle preview: show the most-recent visible entry message.
  const previewEntry = visibleEntries[0];

  // Virtualize the (potentially long) log list. The `<ul>` is the scroll
  // element; entries are newest-first so index 0 (offset 0) is the newest.
  const virtualizer = useVirtualizer({
    count: visibleEntries.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 28,
    overscan: 12,
  });

  // Start subscription on mount.
  useEffect(() => {
    void startLogSubscription();
  }, []);

  // Close panel on Escape (only while expanded). We keep the form-field guard
  // off so Escape still closes the panel from anywhere, matching the prior
  // document-level handler.
  useHotkeys(
    {
      Escape: (e) => {
        if (!expanded) return;
        e.preventDefault();
        toggle();
      },
    },
    [expanded, toggle],
    { ignoreFormFields: false },
  );

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
  }, [visibleEntries.length, expanded, followLogs, scrollPaused, prefersReducedMotion, virtualizer]);

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
  }, []);

  // Navigation handlers.
  const navigateToEntity: EntityNavigateFn = useCallback(
    (entityType, entityId) => {
      const path = buildEntityPath(entityType, entityId);
      void navigate({ to: path as never });
    },
    [navigate],
  );

  const navigateToAudit: AuditNavigateFn = useCallback(
    (requestId) => {
      void navigate({ to: `/audit?requestId=${requestId}` as never });
    },
    [navigate],
  );

  // Export action — uses native file-save dialog (T062 FR-025).
  const handleExport = useCallback(async () => {
    setExportError(null);
    try {
      const requestId = crypto.randomUUID?.() ?? `req-${Date.now()}`;

      // Ask the user where to save the file via the native file-save dialog.
      // Falls back to a temp path when running under mocks or when the API is unavailable.
      let filePath: string | null = null;
      try {
        const { save: showSaveDialog } = await import('@tauri-apps/plugin-dialog');
        filePath = await showSaveDialog({
          title: m.logpanel_save_dialog_title(),
          defaultPath: `astro-log-export-${Date.now()}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
      } catch {
        // Dialog API unavailable (mock mode / test) — use temp path.
        filePath = null;
      }

      if (!filePath) {
        // User cancelled or dialog unavailable.
        return;
      }

      await logExport({
        requestId,
        filePath,
        format: 'json',
        includeDiagnostics: showDiagnostics,
      });
    } catch (err) {
      setExportError(errMessage(err));
    }
  }, [showDiagnostics]);

  return (
    <Collapsible.Root
      open={expanded}
      onOpenChange={toggle}
      className="alm-logpanel"
      role="log"
      aria-label={m.logpanel_aria_label()}
    >
      <div className="alm-logpanel__header">
        <span className="alm-logpanel__title">{m.logpanel_title()}</span>

        {/* Idle preview line (collapsed state) */}
        {!expanded && previewEntry && (
          <span
            className={`alm-logpanel__preview alm-logpanel__event-level--${previewEntry.level}`}
            aria-label={m.logpanel_preview_aria()}
          >
            {formatTimeOfDay(previewEntry.time)} {previewEntry.message}
          </span>
        )}

        {/* Level filter chips (expanded state) */}
        {expanded && (
          <div className="alm-logpanel__filters" role="group" aria-label={m.logpanel_level_filter_aria()}>
            {LEVEL_CHIPS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                className={`alm-btn alm-btn--ghost alm-btn--xs alm-logpanel__chip${
                  levelFilter === chip.value ? ' alm-logpanel__chip--active' : ''
                }`}
                onClick={() => setLevelFilter(chip.value)}
                aria-pressed={levelFilter === chip.value}
              >
                {chip.label}
              </button>
            ))}

            {/* Diagnostics toggle (only when logLevel === "debug") */}
            { }
            {logLevel === 'debug' && (
              <button
                type="button"
                className={`alm-btn alm-btn--ghost alm-btn--xs alm-logpanel__chip${
                  showDiagnostics ? ' alm-logpanel__chip--active' : ''
                }`}
                onClick={() => setShowDiagnostics((v) => !v)}
                aria-pressed={showDiagnostics}
              >
                {m.logpanel_diagnostics()}
              </button>
            )}
          </div>
        )}

        {/* Follow toggle */}
        {expanded && (
          <button
            type="button"
            className={`alm-btn alm-btn--ghost alm-btn--xs${followLogs ? ' alm-logpanel__chip--active' : ''}`}
            onClick={() => setFollowLogs(!followLogs)}
            aria-pressed={followLogs}
            aria-label={followLogs ? m.log_follow_tail_on_aria() : m.log_follow_tail_off_aria()}
            title={scrollPaused && followLogs ? m.log_follow_tail_paused_title() : undefined}
          >
            {followLogs ? (scrollPaused ? m.logpanel_follow_paused() : m.logpanel_follow_active()) : m.logpanel_follow_off()}
          </button>
        )}

        {/* Export button */}
        {expanded && (
          <button
            type="button"
            className="alm-btn alm-btn--ghost alm-btn--xs"
            onClick={() => void handleExport()}
            aria-label={m.logpanel_export_aria()}
          >
            {m.logpanel_export()}
          </button>
        )}

        <Collapsible.Trigger
          className="alm-btn alm-btn--ghost alm-btn--sm"
          aria-label={expanded ? m.log_collapse_panel_aria() : m.log_expand_panel_aria()}
        >
          {expanded ? '▾' : '▸'}
        </Collapsible.Trigger>
      </div>

      {exportError && (
        <div className="alm-logpanel__export-error" role="alert">
          {m.logpanel_export_failed({ error: exportError ?? '' })}
        </div>
      )}

      <Collapsible.Panel className="alm-logpanel__body">
        {/* Truncation marker (A4) */}
        {truncated && (
          <div className="alm-logpanel__truncation-marker" role="note">
            {truncatedCount != null
              ? m.logpanel_history_gap_count({ count: String(truncatedCount) })
              : m.logpanel_history_gap()}
          </div>
        )}

        <ul
          className="alm-logpanel__events alm-virtual-scroll"
          ref={listRef}
          onScroll={handleScroll}
          data-virtual-scroll="true"
        >
          {visibleEntries.length === 0 ? (
            <li className="alm-logpanel__empty">{m.logpanel_empty()}</li>
          ) : (
            <div
              className="alm-virtual-inner"
              // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer total height (getTotalSize)
              style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const entry = visibleEntries[virtualRow.index];
                return (
                  <LogEntryRow
                    key={entry.id}
                    entry={entry}
                    index={virtualRow.index}
                    measureRef={virtualizer.measureElement}
                    // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer translateY offset per row
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    onNavigateEntity={navigateToEntity}
                    onNavigateAudit={navigateToAudit}
                  />
                );
              })}
            </div>
          )}
        </ul>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

// ── LogEntryRow sub-component ─────────────────────────────────────────────────

interface LogEntryRowProps {
  entry: LogEntry;
  onNavigateEntity: EntityNavigateFn;
  onNavigateAudit: AuditNavigateFn;
  /** Virtual-row positioning style (absolute + translateY). */
  style?: React.CSSProperties;
  /** Virtual-row index for the virtualizer's measure cache. */
  index?: number;
  /** Virtualizer measure callback ref. */
  measureRef?: (node: Element | null) => void;
}

function LogEntryRow({
  entry,
  onNavigateEntity,
  onNavigateAudit,
  style,
  index,
  measureRef,
}: LogEntryRowProps) {
  const hasEntityLink = entry.entityType != null && entry.entityId != null;
  const hasAuditLink = entry.requestId != null && !hasEntityLink;

  const handleClick = useCallback(() => {
    if (hasEntityLink && entry.entityType && entry.entityId) {
      onNavigateEntity(entry.entityType, entry.entityId);
    } else if (hasAuditLink && entry.requestId) {
      onNavigateAudit(entry.requestId);
    }
  }, [entry, hasEntityLink, hasAuditLink, onNavigateEntity, onNavigateAudit]);

  const isClickable = hasEntityLink || hasAuditLink;

  return (
    <li
      ref={measureRef}
      data-index={index}
      // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer row style passthrough (absolute + translateY)
      style={style}
      className={`alm-logpanel__event${isClickable ? ' alm-logpanel__event--link' : ''}`}
      onClick={isClickable ? handleClick : undefined}
      role={isClickable ? 'button' : 'listitem'}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
      aria-label={
        isClickable
          ? m.log_entry_navigate_aria({ level: entry.level, message: entry.message })
          : undefined
      }
    >
      <span className="alm-logpanel__event-time">{formatTimeOfDay(entry.time)}</span>
      <span
        className={`alm-logpanel__event-level alm-logpanel__event-level--${entry.level}`}
        aria-label={entry.level}
      >
        {entry.level}
      </span>
      <span className="alm-logpanel__event-source alm-logpanel__event-source--{entry.source}">
        {entry.source}
      </span>
      <span className="alm-logpanel__event-msg">{entry.message}</span>
      {hasEntityLink && (
        <span className="alm-logpanel__event-link-indicator" aria-hidden="true">
          →
        </span>
      )}
    </li>
  );
}
