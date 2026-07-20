// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// First-run wizard: "Scan" step (spec 038).
//
// Registers sources (via flushToDB), then runs inbox_scan_folder +
// inbox_classify per source, showing per-source progress and a detection
// summary.  Approval stays in the Inbox — no inbox_confirm called here.

import { useEffect, useRef, useState } from 'react';
import { Pill } from '@/ui/Pill';
import type { PillVariant } from '@/ui/Pill';
import { Table } from '@/ui';
import type { TableColumn, TableRow } from '@/ui';
import { m } from '@/lib/i18n';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { InboxItemSummary } from '@/bindings/index';
import type { InboxClassifyResponse } from '@/bindings/aliases';
import type { SourceEntry } from '../sources-store';
import type { FlushResult } from '../sources-store';
import { errMessage } from '@/lib/errors';
import { RootDetectionConfig } from '@/features/inventory/RootDetectionConfig';

// ── Types ─────────────────────────────────────────────────────────────────────

type ScanPhase = 'pending' | 'scanning' | 'done' | 'error';

interface SourceScanState {
  source: SourceEntry;
  /** rootId returned by roots_register_batch for this source. */
  rootId: string;
  phase: ScanPhase;
  items: InboxItemSummary[];
  /** Per-item classify results keyed by inboxItemId. */
  classifications: Map<string, InboxClassifyResponse>;
  error?: string;
}

export interface StepScanProps {
  /** All registered sources from the wizard state. */
  sources: SourceEntry[];
  /** Result of flushToDB; rootId per path lets us pass the right id to scan. */
  flushResult: FlushResult;
  /**
   * Called whenever the "all scans done" state changes so the parent can
   * enable/disable the Finish button that now lives in the wizard footer.
   */
  onAllDoneChange: (done: boolean) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function phaseLabel(phase: ScanPhase): string {
  switch (phase) {
    case 'pending':
      return m.setup_scan_phase_pending();
    case 'scanning':
      return m.setup_scan_scanning();
    case 'done':
      return m.setup_scan_phase_done();
    case 'error':
      return m.settings_advanced_log_error();
  }
}

function phasePillVariant(phase: ScanPhase): PillVariant {
  switch (phase) {
    case 'pending':
      return 'neutral';
    case 'scanning':
      return 'warn';
    case 'done':
      return 'ok';
    case 'error':
      return 'danger';
  }
}

/** Derive a stable rootId string from the flushResult for a given path.
 *  Falls back to the path itself when no root was returned (e.g. registration
 *  failed — we still try to scan using the path directly). */
function getRootId(flushResult: FlushResult, path: string): string {
  const row = flushResult.results.find((r) => r.path === path);
  // Successful rows carry the assigned rootId; fall back to the path if absent.
  return row?.rootId ?? path;
}

/** Capitalize the first letter (e.g. "dark" → "Dark"). */
function titleCase(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Human label for a detected calibration master item (spec 040 FR-006).
 * e.g. "Master Dark", "Master Flat · Ha · 120s".  Falls back to a generic
 * "Master" when the base frame type couldn't be inferred.
 */
function masterLabel(item: InboxItemSummary): string {
  const ft: string = item.masterFrameType
    ? m.setup_scan_master_kind({ kind: titleCase(item.masterFrameType) })
    : m.setup_scan_master();
  const parts: string[] = [ft];
  if (item.masterFilter) parts.push(item.masterFilter);
  if (item.masterExposureS != null) parts.push(`${item.masterExposureS}s`);
  return parts.join(' · ');
}

// ── Per-source detection summary ──────────────────────────────────────────────

interface SourceSummaryProps {
  state: SourceScanState;
}

function SourceSummary({ state }: SourceSummaryProps) {
  const { source, rootId, phase, items, classifications, error } = state;
  const [expanded, setExpanded] = useState(false);

  // Spec 048 US4 T035: the wizard's Scan step is the earliest point a newly
  // added raw/calibration root has a real backend id (roots.register.batch
  // already ran via flushToDB before this step mounts) — a dedicated new
  // wizard step was rejected as unwarranted churn for one control (see
  // RootDetectionConfig's doc comment). getRootId() falls back to the raw
  // path string when registration failed; skip rendering in that case since
  // it is not a valid root id.
  const hasRegisteredRoot = rootId !== source.path;
  const isFrameSource =
    source.kind === 'light_frames' || source.kind === 'calibration';

  const totalItems = items.length;
  const totalFiles = items.reduce((acc, it) => acc + it.fileCount, 0);

  // Aggregate breakdown counts across all items, reconciled against the file
  // count (issue #513): masters and unclassified files were previously
  // dropped from this summary because they don't appear in a classify
  // breakdown entry, so the chip counts silently undercounted totalFiles.
  const kindCounts = new Map<string, number>();
  for (const item of items) {
    if (item.isMaster) {
      kindCounts.set(
        'master',
        (kindCounts.get('master') ?? 0) + item.fileCount,
      );
      continue;
    }
    const cls = classifications.get(item.inboxItemId);
    for (const entry of cls?.breakdown ?? []) {
      kindCounts.set(
        entry.kind,
        (kindCounts.get(entry.kind) ?? 0) + entry.count,
      );
    }
    const unclassifiedCount = cls?.unclassifiedFiles.length ?? 0;
    if (unclassifiedCount > 0) {
      kindCounts.set(
        'unclassified',
        (kindCounts.get('unclassified') ?? 0) + unclassifiedCount,
      );
    }
  }

  // Stable sort for the table: by lane, then folder path.
  const sortedItems = [...items].sort(
    (a, b) =>
      a.lane.localeCompare(b.lane) ||
      a.relativePath.localeCompare(b.relativePath),
  );

  // Built per render rather than hoisted to module scope: the `m.*` accessors
  // resolve against the active locale at call time, so hoisting would freeze
  // the header labels to whichever locale was active at import.
  const columns: TableColumn[] = [
    { key: 'folder', label: m.setup_scan_col_folder() },
    { key: 'files', label: m.setup_scan_col_files() },
    { key: 'format', label: m.setup_scan_col_format() },
    { key: 'types', label: m.setup_scan_col_types() },
  ];

  const rows: TableRow[] = sortedItems.map((item) => {
    const cls = classifications.get(item.inboxItemId);
    const typeParts = (cls?.breakdown ?? []).map((b) => `${b.count} ${b.kind}`);
    // Reconcile against fileCount (issue #513): files with no IMAGETYP (or an
    // unmapped one) don't appear in the classify breakdown at all, so the type
    // list previously undercounted the row's file total with no indication why.
    const unclassifiedCount = cls?.unclassifiedFiles.length ?? 0;
    if (unclassifiedCount > 0) {
      typeParts.push(
        m.setup_scan_unclassified_count({ count: unclassifiedCount }),
      );
    }
    const types = typeParts.join(', ');
    return {
      _testid: `scan-item-${item.inboxItemId}`,
      folder: (
        <>
          {item.isMaster && <Pill variant="info">{m.setup_scan_master()}</Pill>}
          {/* The root/top-level row of an expanded folder carries an empty
              relativePath; label it instead of leaving it blank (issue #513). */}
          {item.relativePath || m.setup_scan_root_label()}
        </>
      ),
      files: item.fileCount,
      format: (item.format ?? item.lane).toUpperCase(),
      // Individual calibration masters carry their frame type on the item
      // itself (spec 040 FR-006); grouped sub-frame folders rely on the
      // classify breakdown instead.
      types: item.isMaster ? masterLabel(item) : types || '—',
    };
  });

  // The detail panel (chips + table) is expandable only when scan is done and
  // there are items to show.
  const isExpandable = phase === 'done' && totalItems > 0;

  // Compact count summary for the always-visible header line.
  const countSummary =
    phase === 'done' && totalItems > 0
      ? `${m.setup_scan_folder_count({ count: totalItems })} · ${m.setup_scan_file_count({ count: totalFiles })}`
      : null;

  return (
    <div
      data-testid={`scan-source-${source.path}`}
      className="pv-setup-scan__card"
    >
      {/* ── Always-visible header row ─────────────────────────────────────── */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- conditionally interactive: role=button + keyboard (Enter/Space) handler applied together only when isExpandable; inert div otherwise */}
      <div
        role={isExpandable ? 'button' : undefined}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- tabIndex is paired with role=button (above) only when isExpandable, making the element a focusable button
        tabIndex={isExpandable ? 0 : undefined}
        aria-expanded={isExpandable ? expanded : undefined}
        onClick={isExpandable ? () => setExpanded((v) => !v) : undefined}
        onKeyDown={
          isExpandable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setExpanded((v) => !v);
                }
              }
            : undefined
        }
        className={
          'pv-setup-scan__header' +
          (isExpandable ? ' pv-setup-scan__header--expandable' : '')
        }
      >
        {/* Chevron — only shown when expandable */}
        {isExpandable && (
          <span aria-hidden="true" className="pv-setup-scan__chevron">
            {expanded ? '▾' : '▸'}
          </span>
        )}

        {/* Source path */}
        <span className="pv-setup-scan__path">{source.path}</span>

        {/* Kind label (muted, small) */}
        <span className="pv-setup-scan__kind">
          {source.kind.replace('_', ' ')}
        </span>

        {/* Compact count summary */}
        {countSummary && (
          <span className="pv-setup-scan__count">{countSummary}</span>
        )}

        {/* Phase pill */}
        <Pill variant={phasePillVariant(phase)}>{phaseLabel(phase)}</Pill>
      </div>

      {/* Spec 048 US4 T035: per-root reconcile mode + detection triggers,
          set up at add-time with documented defaults pre-selected. */}
      {isFrameSource && hasRegisteredRoot && (
        <RootDetectionConfig rootId={rootId} />
      )}

      {/* ── Always-visible transient states (below header, outside collapse) ── */}
      {/* These are small/short and don't benefit from collapse. */}
      {phase === 'error' && error && (
        <p className="pv-setup-scan__msg pv-setup-scan__msg--error">{error}</p>
      )}

      {phase === 'scanning' && (
        <p className="pv-setup-scan__msg pv-setup-scan__msg--scanning">
          {m.setup_scan_scanning()}
        </p>
      )}

      {phase === 'done' && totalItems === 0 && (
        <p
          data-testid="scan-empty"
          className="pv-setup-scan__msg pv-setup-scan__msg--empty"
        >
          {m.setup_scan_nothing_detected()}
        </p>
      )}

      {/* ── Collapsible detail panel (chips + table) ─────────────────────── */}
      {isExpandable && expanded && (
        <div className="pv-setup-scan__detail">
          {/* Kind-count chips */}
          {kindCounts.size > 0 && (
            <div className="pv-setup-scan__chips">
              {Array.from(kindCounts.entries()).map(([kind, count]) => (
                <span key={kind} className="pv-setup-scan__chip">
                  {count} {kind}
                </span>
              ))}
            </div>
          )}

          {/* Scrollable metadata table of detected ingestion groups.
              `virtualized` is used for its scroll container + sticky header
              (primitives.css `.pv-table__scroll`), not for windowing — a
              per-source detection list is small. */}
          <Table
            columns={columns}
            rows={rows}
            virtualized
            scrollClassName="pv-setup-scan__table-wrap"
          />
        </div>
      )}
    </div>
  );
}

// ── StepScan ─────────────────────────────────────────────────────────────────

/**
 * Step 5 — Scan.
 *
 * Runs inbox_scan_folder + inbox_classify per registered source and shows a
 * per-source detection summary.  Ingestion-group approval stays in the Inbox;
 * Finish navigates there without calling inbox_confirm.
 *
 * Back and Finish buttons are rendered by the shared WizardShell footer in
 * SetupWizard.  StepScan notifies the parent of scan completion via
 * `onAllDoneChange` so the footer can enable/disable the Finish button.
 */
export function StepScan({
  sources,
  flushResult,
  onAllDoneChange,
}: StepScanProps) {
  const [sourceStates, setSourceStates] = useState<SourceScanState[]>([]);
  // The alreadyRegistered resolution (roots.list) below is async, so
  // sourceStates starts empty even when there is work to do — an empty array
  // vacuously satisfies `.every()`, which would otherwise make `allDone`
  // (below) briefly report true before scanning has even been set up. Gate
  // on this instead of sourceStates.length so the transient empty state
  // isn't mistaken for "nothing to scan".
  const [resolved, setResolved] = useState(false);

  // Guard: track whether scanning has already been initiated to prevent
  // re-entry double-scans when the user navigates Back and then Next again.
  const scanStartedRef = useRef(false);

  useEffect(() => {
    if (scanStartedRef.current) return;
    scanStartedRef.current = true;

    void (async () => {
      // Issue #916: a wizard retry after a partial batch-registration
      // failure resubmits *every* source, not just the ones that failed. A
      // source that registered successfully on an earlier attempt in this
      // same session therefore comes back from flushToDB as
      // `alreadyRegistered` (duplicate) on the retry — the exact same shape
      // a genuinely-already-scanned restart-flow source has (issue #704).
      // flushResult alone can't tell the two apart: one has already been
      // scanned and is safe to skip, the other has never been scanned and
      // must not be dropped. Resolve the real root via roots.list and use
      // its `lastScanned` (only set once inbox.scan_folder has actually run
      // for that root — see roots.rs) as the ground truth.
      const needsResolution = sources.filter((s) => {
        if (!s.path) return false;
        const row = flushResult.results.find((r) => r.path === s.path);
        return row?.alreadyRegistered ?? false;
      });

      const resolvedRoots = new Map<
        string,
        { id: string; lastScanned: string | null }
      >();
      if (needsResolution.length > 0) {
        try {
          const roots = unwrap(await commands.rootsList());
          for (const root of roots) {
            resolvedRoots.set(root.path, {
              id: root.id,
              lastScanned: root.lastScanned ?? null,
            });
          }
        } catch {
          // Best-effort: an unresolved lookup falls through to the
          // conservative default below (skip — matches prior behaviour).
        }
      }

      // Issue #704 / #916: only scan folders this flush actually registered,
      // or that a prior same-session attempt registered but never scanned. A
      // root whose registration failed for a genuine reason (no rootId, not
      // `alreadyRegistered`) is skipped — scanning it with the
      // path-as-rootId fallback fails the registered_sources JOIN and would
      // insert orphaned inbox_items.
      const initialStates: SourceScanState[] = [];
      for (const s of sources) {
        if (!s.path) continue;
        const row = flushResult.results.find((r) => r.path === s.path);
        if (row?.success) {
          initialStates.push({
            source: s,
            rootId: getRootId(flushResult, s.path),
            phase: 'pending',
            items: [],
            classifications: new Map(),
          });
          continue;
        }
        if (!row?.alreadyRegistered) continue;

        const resolvedRoot = resolvedRoots.get(s.path);
        if (resolvedRoot != null && resolvedRoot.lastScanned != null) {
          // Genuinely already scanned in a prior session — safe to skip.
          continue;
        }
        if (resolvedRoot != null) {
          // Registered but never scanned (same-session retry) — rescan
          // using the real resolved rootId.
          initialStates.push({
            source: s,
            rootId: resolvedRoot.id,
            phase: 'pending',
            items: [],
            classifications: new Map(),
          });
          continue;
        }
        // Review round 2 #1: roots.list failed or returned no match for this
        // path — we can't tell whether this source was already scanned.
        // Silently excluding it here would resurrect the exact #916 bug via
        // a resolution failure instead of a misclassification, so surface it
        // as a visible error state instead of dropping it.
        initialStates.push({
          source: s,
          rootId: s.path,
          phase: 'error',
          items: [],
          classifications: new Map(),
          error: m.setup_scan_resolution_failed(),
        });
      }

      setSourceStates(initialStates);
      setResolved(true);

      // Scan each source independently; one failure doesn't abort others.
      for (let i = 0; i < initialStates.length; i++) {
        const idx = i;
        const entry = initialStates[idx];
        // Already flagged (resolution failure above) — nothing to scan.
        if (entry.phase === 'error') continue;

        void (async () => {
          // Mark as scanning
          setSourceStates((prev) => {
            const next = [...prev];
            next[idx] = { ...next[idx], phase: 'scanning' };
            return next;
          });

          try {
            // 1. Scan the folder
            const scanResponse = unwrap(
              await commands.inboxScanFolder({
                rootId: entry.rootId,
                rootAbsolutePath: entry.source.path,
              }),
            );

            const items = scanResponse.items ?? [];

            // 2. Classify each discovered item
            const classifications = new Map<string, InboxClassifyResponse>();
            await Promise.allSettled(
              items.map(async (item) => {
                try {
                  const cls = unwrap(
                    await commands.inboxClassify({
                      inboxItemId: item.inboxItemId,
                      rootAbsolutePath: entry.source.path,
                    }),
                  );
                  classifications.set(item.inboxItemId, cls);
                } catch {
                  // Classification failure for one item: skip but don't abort
                }
              }),
            );

            setSourceStates((prev) => {
              const next = [...prev];
              next[idx] = {
                ...next[idx],
                phase: 'done',
                items,
                classifications,
              };
              return next;
            });
          } catch (err: unknown) {
            setSourceStates((prev) => {
              const next = [...prev];
              next[idx] = {
                ...next[idx],
                phase: 'error',
                error: errMessage(err),
              };
              return next;
            });
          }
        })();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty: run once on mount

  const allDone =
    resolved &&
    sourceStates.every((s) => s.phase === 'done' || s.phase === 'error');
  const totalDetected = sourceStates.reduce(
    (acc, s) => acc + s.items.length,
    0,
  );

  // Notify parent whenever the allDone state changes so the footer can
  // enable/disable the Finish button.
  useEffect(() => {
    onAllDoneChange(allDone);
  }, [allDone, onAllDoneChange]);

  return (
    <div className="pv-setup-scan" data-testid="step-scan">
      {!resolved ? null : sourceStates.length === 0 ? (
        // Review round 2 #2: gated on `resolved` (not sourceStates.length
        // alone) so this genuinely-empty message can't flash for real
        // sources while the alreadyRegistered resolution above is pending.
        <p className="pv-setup-scan__empty-msg">{m.setup_scan_no_sources()}</p>
      ) : (
        <>
          {/* Per-source results — scrollable region; expanding accordions scroll here,
              not the whole wizard page. */}
          <div className="pv-setup-scan__scroll">
            {sourceStates.map((s) => (
              <SourceSummary key={s.source.path} state={s} />
            ))}
          </div>

          {/* Summary line (shown when all sources are complete) */}
          {allDone && (
            <p data-testid="scan-summary" className="pv-setup-scan__summary">
              {totalDetected > 0
                ? m.setup_scan_summary_found({ count: totalDetected })
                : m.setup_scan_summary_empty()}
            </p>
          )}
        </>
      )}
    </div>
  );
}
