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
} from '@/data/logStore';
import { startLogSubscription } from '@/data/logSubscription';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { LevelFilter } from './LogPanelContext';
import { errMessage } from '@/lib/errors';
import { useHotkeys } from '@/lib/useHotkeys';
import { EmptyState } from '@/ui/EmptyState';
import { observeElementOffsetWithCleanup } from '@/lib/observe-element-offset';
import {
  LEVEL_CHIPS,
  ALL_LOG_SOURCES,
  passesLevelFilter,
  passesSourceFilter,
  activeFilterLabel,
  buildEntityPath,
  type EntityNavigateFn,
  type AuditNavigateFn,
} from './log-panel-model';
import { useFollowTail } from './useFollowTail';
import { LogEntryRow } from './LogEntryRow';

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
    // astro-plan-99u: upstream's default leaks a debounce timer past
    // unmount/teardown — see observeElementOffsetWithCleanup above.
    observeElementOffset: observeElementOffsetWithCleanup,
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

  // Follow-tail scroll behaviour.
  const { scrollPaused, handleScroll, toggleFollow } = useFollowTail({
    expanded,
    followLogs,
    setFollowLogs,
    entryCount: visibleEntries.length,
    virtualizer,
    listRef,
    prefersReducedMotion,
  });

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
              onClick={toggleFollow}
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
