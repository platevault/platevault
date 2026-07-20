// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bottom log panel (spec 019).
 *
 * - Full-width fold-out driven by `LogPanelContext`.
 * - Level filter chips (session-only, resets to 'all' on open). Selecting a
 *   level is a severity floor — it shows that level and everything more
 *   severe, not an exact match (#582).
 * - Follow-tail toggle (persisted via `rememberFollowLogs` setting).
 * - Diagnostics toggle (gated by `logLevel === "debug"`).
 * - Cross-link: clicking a row with `entityType` + `entityId` navigates to
 *   the entity page; rows with only `requestId` navigate to the audit timeline.
 * - Export action in the panel header.
 * - Truncation marker when history gap is detected.
 * - Escape key closes the panel.
 */
import {
  useEffect,
  useRef,
  useCallback,
  useSyncExternalStore,
  useState,
} from 'react';
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
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { LevelFilter } from './LogPanelContext';
import { errMessage } from '@/lib/errors';
import { formatTimeOfDay } from '@/lib/datetime';
import { useHotkeys } from '@/lib/useHotkeys';
import { EmptyState } from '@/ui/EmptyState';

// ── Level chip display helpers ────────────────────────────────────────────────

// `label` is a render-time thunk so it re-reads the active locale (spec 046 #8).
const LEVEL_CHIPS: { value: LevelFilter; label: () => string }[] = [
  { value: 'all', label: () => m.common_all() },
  { value: 'error', label: () => m.settings_advanced_log_error() },
  { value: 'warn', label: () => m.settings_advanced_log_warn() },
  { value: 'info', label: () => m.settings_advanced_log_info() },
  { value: 'debug', label: () => m.settings_advanced_log_debug() },
];

// Severity order (ascending). A level-chip selection is a floor: choosing
// e.g. "warn" shows warn AND error, matching conventional log-viewer
// semantics rather than an exact-level match (#582).
const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function passesLevelFilter(entryLevel: LogLevel, filter: LevelFilter): boolean {
  if (filter === 'all') return true;
  return LEVEL_SEVERITY[entryLevel] >= LEVEL_SEVERITY[filter];
}

function passesSourceFilter(
  entrySource: LogEntrySource,
  filter: LogEntrySource[],
): boolean {
  if (filter.length === 0) return true;
  return filter.includes(entrySource);
}

// All known log-entry sources, for the category/source filter chips (#666).
// Kept local (not exported from `data/logStore`) — this is a UI concern only.
const ALL_LOG_SOURCES: LogEntrySource[] = [
  'audit',
  'diagnostic',
  'catalog',
  'plan',
  'workflow',
  'lifecycle',
  'inventory',
  'settings',
  'project',
  'target',
  'tool',
];

/**
 * Names the filters currently narrowing the list, or `null` when none of the
 * user-selectable filters is active.
 *
 * #669 / Journey 13: a filtered-to-empty log must never render the same copy
 * as a log that recorded nothing, so the empty state names what is excluding
 * the rows. Returns `null` when only the non-user-selectable diagnostics gate
 * is doing the excluding — there is no filter name to show the user then.
 */
function activeFilterLabel(
  levelFilter: LevelFilter,
  sourceFilter: LogEntrySource[],
): string | null {
  const parts: string[] = [];
  if (levelFilter !== 'all') {
    const chip = LEVEL_CHIPS.find((c) => c.value === levelFilter);
    if (chip) parts.push(chip.label());
  }
  parts.push(...sourceFilter);
  return parts.length > 0 ? parts.join(', ') : null;
}

// ── Entity navigation helpers ─────────────────────────────────────────────────

type EntityNavigateFn = (entityType: string, entityId: string) => void;
type AuditNavigateFn = (requestId: string) => void;

/**
 * Resolve an entity link's destination path, or `null` when the entity type
 * has no deep-linkable destination yet (row still shows subject-context text,
 * just without click affordance).
 *
 * `plan` is intentionally not linked — no `/plans/:id` route exists yet (#626);
 * `catalog` and the fallback point at the real Settings panes (`/settings/$pane`
 * is a plain path segment, so a literal string is fine here — no route for
 * `/audit` or `/settings?tab=catalogs` ever existed).
 */
function buildEntityPath(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case 'plan':
      return null;
    case 'project':
      return `/projects/${entityId}`;
    case 'session':
      return `/sessions/${entityId}`;
    case 'target':
      return `/targets/${entityId}`;
    case 'catalog':
      return `/settings/catalogs`;
    default:
      return `/settings/audit?entityType=${entityType}&entityId=${entityId}`;
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
    setSourceFilter,
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

  const filterLabel = activeFilterLabel(levelFilter, sourceFilter);

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
  }, [
    visibleEntries.length,
    expanded,
    followLogs,
    scrollPaused,
    prefersReducedMotion,
    virtualizer,
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
  }, []);

  // Navigation handlers.
  const navigateToEntity: EntityNavigateFn = useCallback(
    (entityType, entityId) => {
      const path = buildEntityPath(entityType, entityId);
      if (path == null) return;
      void navigate({ to: path as never });
    },
    [navigate],
  );

  const navigateToAudit: AuditNavigateFn = useCallback(
    (requestId) => {
      void navigate({ to: `/settings/audit?requestId=${requestId}` as never });
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
        const { save: showSaveDialog } = await import(
          '@tauri-apps/plugin-dialog'
        );
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

      unwrap(
        await commands.logExport(
          requestId,
          filePath,
          'json',
          null,
          null,
          null,
          showDiagnostics,
        ),
      );
    } catch (err) {
      setExportError(errMessage(err));
    }
  }, [showDiagnostics]);

  return (
    <Collapsible.Root
      open={expanded}
      onOpenChange={toggle}
      className="pv-logpanel"
      role="log"
      aria-label={m.logpanel_aria_label()}
    >
      <div className="pv-logpanel__header">
        <span className="pv-logpanel__title">{m.logpanel_title()}</span>

        {/* Level filter chips (expanded state) */}
        {expanded && (
          <div
            className="pv-logpanel__filters"
            role="group"
            aria-label={m.logpanel_level_filter_aria()}
          >
            {LEVEL_CHIPS.map((chip) => (
              <button
                key={chip.value}
                type="button"
                className={`pv-btn pv-btn--ghost pv-btn--xs pv-logpanel__chip${
                  levelFilter === chip.value ? ' pv-logpanel__chip--active' : ''
                }`}
                onClick={() => setLevelFilter(chip.value)}
                aria-pressed={levelFilter === chip.value}
                // Disambiguates from the category/source filter's own "All"
                // chip below — both groups have a visible "All" label, but
                // e2e/a11y queries need distinct accessible names.
                aria-label={
                  chip.value === 'all' ? m.logpanel_level_all_aria() : undefined
                }
              >
                {chip.label()}
              </button>
            ))}

            {/* Diagnostics toggle (only when logLevel === "debug") */}
            {}
            {logLevel === 'debug' && (
              <button
                type="button"
                className={`pv-btn pv-btn--ghost pv-btn--xs pv-logpanel__chip${
                  showDiagnostics ? ' pv-logpanel__chip--active' : ''
                }`}
                onClick={() => setShowDiagnostics((v) => !v)}
                aria-pressed={showDiagnostics}
              >
                {m.logpanel_diagnostics()}
              </button>
            )}
          </div>
        )}

        {/* Category/source filter chips (#666) */}
        {expanded && (
          <div
            className="pv-logpanel__filters pv-logpanel__filters--sources"
            role="group"
            aria-label={m.logpanel_source_filter_aria()}
          >
            <button
              type="button"
              className={`pv-btn pv-btn--ghost pv-btn--xs pv-logpanel__chip${
                sourceFilter.length === 0 ? ' pv-logpanel__chip--active' : ''
              }`}
              onClick={() => setSourceFilter([])}
              aria-pressed={sourceFilter.length === 0}
              aria-label={m.logpanel_source_all_aria()}
            >
              {m.common_all()}
            </button>
            {ALL_LOG_SOURCES.map((source) => (
              <button
                key={source}
                type="button"
                className={`pv-btn pv-btn--ghost pv-btn--xs pv-logpanel__chip${
                  sourceFilter.length === 0 || sourceFilter.includes(source)
                    ? ' pv-logpanel__chip--active'
                    : ''
                }`}
                onClick={() =>
                  setSourceFilter(
                    sourceFilter.length === 0
                      ? [source]
                      : sourceFilter.includes(source)
                        ? sourceFilter.filter((s) => s !== source)
                        : [...sourceFilter, source],
                  )
                }
                aria-pressed={
                  sourceFilter.length === 0 || sourceFilter.includes(source)
                }
              >
                {source}
              </button>
            ))}
          </div>
        )}

        {/* Actions — pinned to the header's trailing edge so they keep a
            stable position as the filter chips wrap onto more rows. */}
        <div className="pv-logpanel__actions">
          {/* Follow toggle */}
          {expanded && (
            <button
              type="button"
              className={`pv-btn pv-btn--ghost pv-btn--xs${followLogs ? ' pv-logpanel__chip--active' : ''}`}
              onClick={() => {
                const next = !followLogs;
                setFollowLogs(next);
                // #832: re-enabling Follow must resume at the newest row even
                // if a manual scroll-up left `scrollPaused` set — otherwise
                // the follow-tail effect's guard (`!followLogs ||
                // scrollPaused`) silently no-ops and the toggle looks broken.
                if (next) setScrollPaused(false);
              }}
              aria-pressed={followLogs}
              aria-label={
                followLogs
                  ? m.log_follow_tail_on_aria()
                  : m.log_follow_tail_off_aria()
              }
              title={
                scrollPaused && followLogs
                  ? m.log_follow_tail_paused_title()
                  : undefined
              }
            >
              {followLogs
                ? scrollPaused
                  ? m.logpanel_follow_paused()
                  : m.logpanel_follow_active()
                : m.logpanel_follow_off()}
            </button>
          )}

          {/* Export button */}
          {expanded && (
            <button
              type="button"
              className="pv-btn pv-btn--ghost pv-btn--xs"
              onClick={() => void handleExport()}
              aria-label={m.logpanel_export_aria()}
            >
              {m.logpanel_export()}
            </button>
          )}

          <Collapsible.Trigger
            className="pv-btn pv-btn--ghost pv-btn--sm"
            aria-label={
              expanded ? m.log_collapse_panel_aria() : m.log_expand_panel_aria()
            }
          >
            {expanded ? '▾' : '▸'}
          </Collapsible.Trigger>
        </div>
      </div>

      {exportError && (
        <div className="pv-logpanel__export-error" role="alert">
          {m.logpanel_export_failed({ error: exportError ?? '' })}
        </div>
      )}

      <Collapsible.Panel className="pv-logpanel__body">
        {/* Truncation marker (A4) */}
        {truncated && (
          <div className="pv-logpanel__truncation-marker" role="note">
            {truncatedCount != null
              ? m.logpanel_history_gap_count({ count: String(truncatedCount) })
              : m.logpanel_history_gap()}
          </div>
        )}

        <ul
          className="pv-logpanel__events pv-virtual-scroll"
          ref={listRef}
          onScroll={handleScroll}
          data-virtual-scroll="true"
        >
          {visibleEntries.length === 0 ? (
            <li className="pv-logpanel__empty">
              {/* #669: a filtered-to-empty view must not read as "nothing
                  was ever recorded" when entries exist but the active
                  filter excludes all of them — so name the filter. */}
              <EmptyState
                title={
                  entries.length === 0
                    ? m.logpanel_empty()
                    : filterLabel != null
                      ? m.logpanel_empty_filtered_named({ filter: filterLabel })
                      : m.logpanel_empty_filtered()
                }
              />
            </li>
          ) : (
            <div
              className="pv-virtual-inner"
              // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer total height (getTotalSize)
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: 'relative',
              }}
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
  const hasEntity = entry.entityType != null && entry.entityId != null;
  // #626: a link is only "linkable" when a real route exists for it (e.g.
  // `plan` has no destination yet — buildEntityPath returns null for it).
  const hasEntityLink =
    hasEntity &&
    buildEntityPath(entry.entityType ?? '', entry.entityId ?? '') != null;
  const hasAuditLink = entry.requestId != null && !hasEntity;
  // Subject context (#583): the entity/request the line is about, surfaced
  // as visible text rather than only implied by the click-to-navigate arrow.
  // Shown even when the entity has no link yet (e.g. `plan`, #626) so the
  // context isn't lost, just the click affordance.
  const contextLabel = hasEntity
    ? `${entry.entityType} · ${entry.entityId}`
    : hasAuditLink
      ? entry.requestId
      : null;

  const handleClick = useCallback(() => {
    if (hasEntityLink && entry.entityType && entry.entityId) {
      onNavigateEntity(entry.entityType, entry.entityId);
    } else if (hasAuditLink && entry.requestId) {
      onNavigateAudit(entry.requestId);
    }
  }, [entry, hasEntityLink, hasAuditLink, onNavigateEntity, onNavigateAudit]);

  const isClickable = hasEntityLink || hasAuditLink;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- interactivity is conditional; role/tabindex/keydown all upgrade to button only when clickable
    <li
      ref={measureRef}
      data-index={index}
      // eslint-disable-next-line no-restricted-syntax -- dynamic: virtualizer row style passthrough (absolute + translateY)
      style={style}
      className={`pv-logpanel__event${isClickable ? ' pv-logpanel__event--link' : ''}`}
      onClick={isClickable ? handleClick : undefined}
      role={isClickable ? 'button' : 'listitem'}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- only focusable when clickable, where role becomes button
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
          ? m.log_entry_navigate_aria({
              level: entry.level,
              message: entry.message,
            })
          : undefined
      }
    >
      <span className="pv-logpanel__event-time">
        {formatTimeOfDay(entry.time)}
      </span>
      <span
        className={`pv-logpanel__event-level pv-logpanel__event-level--${entry.level}`}
        aria-label={entry.level}
      >
        {entry.level}
      </span>
      <span
        className={`pv-logpanel__event-source pv-logpanel__event-source--${entry.source}`}
      >
        {entry.source}
      </span>
      {contextLabel && (
        <span className="pv-logpanel__event-context" title={contextLabel}>
          {contextLabel}
        </span>
      )}
      <span className="pv-logpanel__event-msg">{entry.message}</span>
      {hasEntityLink && (
        <span className="pv-logpanel__event-link-indicator" aria-hidden="true">
          →
        </span>
      )}
    </li>
  );
}
