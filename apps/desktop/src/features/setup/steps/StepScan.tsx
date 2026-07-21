// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// First-run wizard: "Scan" step (spec 038).
//
// Registers sources (via flushToDB), then runs inbox_scan_folder +
// inbox_classify per source, showing per-source progress and a detection
// summary.  Approval stays in the Inbox — no inbox_confirm called here.

import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { Pill } from '@/ui/Pill';
import type { PillVariant } from '@/ui/Pill';
import { Table } from '@/ui';
import type { TableColumn, TableRow } from '@/ui';
import { m } from '@/lib/i18n';
import { masterLabel } from '@/lib/master-label';
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
  /**
   * Items whose classify call FAILED, as opposed to succeeding with nothing to
   * report. Without this the two are indistinguishable downstream: a missing
   * map entry renders exactly like an empty classification, so a crashed
   * folder showed an em dash and silently dropped out of the per-kind chips
   * while still counting toward the header's file total — the same
   * reconciliation gap issue #513 closed for unmapped IMAGETYP.
   */
  classifyFailures: Set<string>;
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

// ── Per-source detection summary ──────────────────────────────────────────────

interface SourceSummaryProps {
  state: SourceScanState;
}

function SourceSummary({ state }: SourceSummaryProps) {
  const {
    source,
    rootId,
    phase,
    items,
    classifications,
    classifyFailures,
    error,
  } = state;
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
    if (classifyFailures.has(item.inboxItemId)) {
      // Count them so the chips still add up to the header total; a folder that
      // failed must not simply vanish from the breakdown.
      kindCounts.set(
        'failed',
        (kindCounts.get('failed') ?? 0) + item.fileCount,
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
        <span className="pv-table__cell-inline">
          {item.isMaster && <Pill variant="info">{m.setup_scan_master()}</Pill>}
          {/* The root/top-level row of an expanded folder carries an empty
              relativePath; label it instead of leaving it blank (issue #513). */}
          {item.relativePath || m.setup_scan_root_label()}
        </span>
      ),
      files: item.fileCount,
      format: (item.format ?? item.lane).toUpperCase(),
      // Individual calibration masters carry their frame type on the item
      // itself (spec 040 FR-006); grouped sub-frame folders rely on the
      // classify breakdown instead.
      types: item.isMaster
        ? masterLabel(item)
        : classifyFailures.has(item.inboxItemId)
          ? m.setup_scan_classify_failed()
          : types || '—',
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

// One scan+classify pass for a single source. Classify failures are captured
// per-item (never thrown) so one bad folder doesn't fail the whole query —
// only a `scanFolder` failure itself surfaces as the query's error.
async function scanAndClassify(
  rootId: string,
  rootAbsolutePath: string,
): Promise<{
  items: InboxItemSummary[];
  classifications: Map<string, InboxClassifyResponse>;
  classifyFailures: Set<string>;
}> {
  const scanResponse = unwrap(
    await commands.inboxScanFolder({ rootId, rootAbsolutePath }),
  );
  const items = scanResponse.items ?? [];

  const classifications = new Map<string, InboxClassifyResponse>();
  const classifyFailures = new Set<string>();
  await Promise.allSettled(
    items.map(async (item) => {
      try {
        const cls = unwrap(
          await commands.inboxClassify({
            inboxItemId: item.inboxItemId,
            rootAbsolutePath,
          }),
        );
        classifications.set(item.inboxItemId, cls);
      } catch {
        // Don't abort the whole scan for one item — but do record it.
        // Swallowing it entirely made a crash look like a clean "nothing
        // detected" result.
        classifyFailures.add(item.inboxItemId);
      }
    }),
  );
  return { items, classifications, classifyFailures };
}

/** A source resolved to a real backend root, ready to scan+classify. */
interface ScanRenderTarget {
  source: SourceEntry;
  rootId: string;
  kind: 'scan';
}
/** A source whose already-scanned status couldn't be resolved (roots.list
 * failed or returned no match) — surfaced as a static error, never scanned. */
interface ResolutionErrorRenderTarget {
  source: SourceEntry;
  rootId: string;
  kind: 'resolution-error';
}
type RenderTarget = ScanRenderTarget | ResolutionErrorRenderTarget;

function isScanTarget(t: RenderTarget): t is ScanRenderTarget {
  return t.kind === 'scan';
}

/** Map a `useQueries` result onto the same phase vocabulary the (still
 * hand-rolled) `pending`/`scanning` display states used. */
function queryPhase(q: {
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
}): ScanPhase {
  if (q.status === 'success') return 'done';
  if (q.status === 'error') return 'error';
  return q.fetchStatus === 'fetching' ? 'scanning' : 'pending';
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
 *
 * TanStack Query (#615/#630) replaces the former manual `cancelled`-flag
 * orchestration. Query-cache identity (keyed per source) is what now protects
 * against React StrictMode's mount→cleanup→remount double-invoke: the
 * remounted observer subscribes to the SAME in-flight/cached query instead of
 * starting a second scan, which is what a re-entry ref-guard was trying (and
 * failing) to achieve by hand — see git history for that bug.
 */
export function StepScan({
  sources,
  flushResult,
  onAllDoneChange,
}: StepScanProps) {
  // Issue #916: a wizard retry after a partial batch-registration failure
  // resubmits *every* source, not just the ones that failed. A source that
  // registered successfully on an earlier attempt in this same session
  // therefore comes back from flushToDB as `alreadyRegistered` (duplicate) on
  // the retry — the exact same shape a genuinely-already-scanned
  // restart-flow source has (issue #704). flushResult alone can't tell the
  // two apart: one has already been scanned and is safe to skip, the other
  // has never been scanned and must not be dropped. Resolve the real root via
  // roots.list and use its `lastScanned` (only set once inbox.scan_folder has
  // actually run for that root — see roots.rs) as the ground truth.
  const needsResolution = useMemo(
    () =>
      sources.filter((s) => {
        if (!s.path) return false;
        const row = flushResult.results.find((r) => r.path === s.path);
        return row?.alreadyRegistered ?? false;
      }),
    [sources, flushResult],
  );

  const rootsResolveQuery = useQuery({
    queryKey: ['setup', 'rootsResolve'] as const,
    queryFn: async () => unwrap(await commands.rootsList()),
    enabled: needsResolution.length > 0,
    retry: false,
  });

  const resolvedRoots = useMemo(() => {
    const map = new Map<string, { id: string; lastScanned: string | null }>();
    for (const root of rootsResolveQuery.data ?? []) {
      map.set(root.path, {
        id: root.id,
        lastScanned: root.lastScanned ?? null,
      });
    }
    return map;
  }, [rootsResolveQuery.data]);

  // Mirrors the former `resolved` flag: true once the alreadyRegistered
  // resolution has settled (success or failure) or was never needed.
  const resolutionReady =
    needsResolution.length === 0 || rootsResolveQuery.isFetched;

  // Issue #704 / #916: only scan folders this flush actually registered, or
  // that a prior same-session attempt registered but never scanned. A root
  // whose registration failed for a genuine reason (no rootId, not
  // `alreadyRegistered`) is skipped — scanning it with the path-as-rootId
  // fallback fails the registered_sources JOIN and would insert orphaned
  // inbox_items. A source genuinely already scanned in a prior session is
  // skipped entirely (not rendered at all), matching the prior behaviour.
  const renderTargets = useMemo((): RenderTarget[] | undefined => {
    if (!resolutionReady) return undefined;
    const out: RenderTarget[] = [];
    for (const s of sources) {
      if (!s.path) continue;
      const row = flushResult.results.find((r) => r.path === s.path);
      if (row?.success) {
        out.push({
          source: s,
          rootId: getRootId(flushResult, s.path),
          kind: 'scan',
        });
        continue;
      }
      if (!row?.alreadyRegistered) continue;

      const resolvedRoot = resolvedRoots.get(s.path);
      if (resolvedRoot != null && resolvedRoot.lastScanned != null) {
        continue; // genuinely already scanned — safe to skip
      }
      if (resolvedRoot != null) {
        out.push({ source: s, rootId: resolvedRoot.id, kind: 'scan' });
        continue;
      }
      // Review round 2 #1: roots.list failed or returned no match for this
      // path — we can't tell whether this source was already scanned.
      // Silently excluding it here would resurrect the exact #916 bug via a
      // resolution failure instead of a misclassification, so surface it as
      // a visible error state instead of dropping it.
      out.push({ source: s, rootId: s.path, kind: 'resolution-error' });
    }
    return out;
  }, [sources, flushResult, resolvedRoots, resolutionReady]);

  const scanTargets = useMemo(
    () => (renderTargets ?? []).filter(isScanTarget),
    [renderTargets],
  );

  // One query per source (StrictMode-safe dedup via the shared query cache —
  // see the StepScan doc comment above). `retry`/`refetchOnWindowFocus` are
  // disabled: a scan is a one-shot wizard action, not a resource to silently
  // re-fetch or retry behind the user's back.
  const scanQueries = useQueries({
    queries: scanTargets.map((t) => ({
      queryKey: ['setup', 'scan', t.rootId, t.source.path] as const,
      queryFn: () => scanAndClassify(t.rootId, t.source.path),
      retry: false,
      refetchOnWindowFocus: false,
    })),
  });

  const sourceStates: SourceScanState[] = useMemo(() => {
    const scanResultByPath = new Map(
      scanTargets.map((t, i) => [t.source.path, scanQueries[i]]),
    );
    return (renderTargets ?? []).map((t): SourceScanState => {
      if (t.kind === 'resolution-error') {
        return {
          source: t.source,
          rootId: t.rootId,
          phase: 'error',
          items: [],
          classifications: new Map(),
          classifyFailures: new Set(),
          error: m.setup_scan_resolution_failed(),
        };
      }
      const q = scanResultByPath.get(t.source.path);
      return {
        source: t.source,
        rootId: t.rootId,
        phase: q ? queryPhase(q) : 'pending',
        items: q?.data?.items ?? [],
        classifications: q?.data?.classifications ?? new Map(),
        classifyFailures: q?.data?.classifyFailures ?? new Set(),
        error: q?.error ? errMessage(q.error) : undefined,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderTargets, scanTargets, scanQueries]);

  const resolved = resolutionReady;
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
