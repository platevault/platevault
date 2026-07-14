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

  // Aggregate breakdown counts across all classified items
  const kindCounts = new Map<string, number>();
  for (const [, cls] of classifications) {
    for (const entry of cls.breakdown ?? []) {
      kindCounts.set(
        entry.kind,
        (kindCounts.get(entry.kind) ?? 0) + entry.count,
      );
    }
  }

  // Stable sort for the table: by lane, then folder path.
  const sortedItems = [...items].sort(
    (a, b) =>
      a.lane.localeCompare(b.lane) ||
      a.relativePath.localeCompare(b.relativePath),
  );

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
      className="alm-setup-scan__card"
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
          'alm-setup-scan__header' +
          (isExpandable ? ' alm-setup-scan__header--expandable' : '')
        }
      >
        {/* Chevron — only shown when expandable */}
        {isExpandable && (
          <span aria-hidden="true" className="alm-setup-scan__chevron">
            {expanded ? '▾' : '▸'}
          </span>
        )}

        {/* Source path */}
        <span className="alm-setup-scan__path">{source.path}</span>

        {/* Kind label (muted, small) */}
        <span className="alm-setup-scan__kind">
          {source.kind.replace('_', ' ')}
        </span>

        {/* Compact count summary */}
        {countSummary && (
          <span className="alm-setup-scan__count">{countSummary}</span>
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
        <p className="alm-setup-scan__msg alm-setup-scan__msg--error">
          {error}
        </p>
      )}

      {phase === 'scanning' && (
        <p className="alm-setup-scan__msg alm-setup-scan__msg--scanning">
          {m.setup_scan_scanning()}
        </p>
      )}

      {phase === 'done' && totalItems === 0 && (
        <p
          data-testid="scan-empty"
          className="alm-setup-scan__msg alm-setup-scan__msg--empty"
        >
          {m.setup_scan_nothing_detected()}
        </p>
      )}

      {/* ── Collapsible detail panel (chips + table) ─────────────────────── */}
      {isExpandable && expanded && (
        <div className="alm-setup-scan__detail">
          {/* Kind-count chips */}
          {kindCounts.size > 0 && (
            <div className="alm-setup-scan__chips">
              {Array.from(kindCounts.entries()).map(([kind, count]) => (
                <span key={kind} className="alm-setup-scan__chip">
                  {count} {kind}
                </span>
              ))}
            </div>
          )}

          {/* Scrollable metadata table of detected ingestion groups */}
          <div className="alm-setup-scan__table-wrap">
            <table className="alm-setup-scan__table">
              <thead>
                <tr className="alm-setup-scan__thead-row">
                  <th className="alm-setup-scan__cell">
                    {m.setup_scan_col_folder()}
                  </th>
                  <th className="alm-setup-scan__cell">
                    {m.setup_scan_col_files()}
                  </th>
                  <th className="alm-setup-scan__cell">
                    {m.setup_scan_col_format()}
                  </th>
                  <th className="alm-setup-scan__cell">
                    {m.setup_scan_col_types()}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item) => {
                  const breakdown =
                    classifications.get(item.inboxItemId)?.breakdown ?? [];
                  const types = breakdown
                    .map((b) => `${b.count} ${b.kind}`)
                    .join(', ');
                  // Individual calibration masters carry their frame type on the
                  // item itself (spec 040 FR-006); grouped sub-frame folders rely
                  // on the classify breakdown instead.
                  const detectedTypes = item.isMaster
                    ? masterLabel(item)
                    : types || '—';
                  return (
                    <tr
                      key={item.inboxItemId}
                      data-testid={`scan-item-${item.inboxItemId}`}
                      className="alm-setup-scan__tbody-row"
                    >
                      <td className="alm-setup-scan__cell--path">
                        <span className="alm-setup-scan__path-cell-inner">
                          {item.isMaster && (
                            <Pill variant="info">{m.setup_scan_master()}</Pill>
                          )}
                          {item.relativePath}
                        </span>
                      </td>
                      <td className="alm-setup-scan__cell">{item.fileCount}</td>
                      <td className="alm-setup-scan__cell">
                        {(item.format ?? item.lane).toUpperCase()}
                      </td>
                      <td className="alm-setup-scan__cell">{detectedTypes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
  const [sourceStates, setSourceStates] = useState<SourceScanState[]>(() =>
    sources
      .filter((s) => s.path)
      .map((s) => ({
        source: s,
        rootId: getRootId(flushResult, s.path),
        phase: 'pending',
        items: [],
        classifications: new Map(),
      })),
  );

  // Guard: track whether scanning has already been initiated to prevent
  // re-entry double-scans when the user navigates Back and then Next again.
  const scanStartedRef = useRef(false);

  useEffect(() => {
    if (scanStartedRef.current) return;
    scanStartedRef.current = true;

    // Scan each source independently; one failure doesn't abort others.
    for (let i = 0; i < sourceStates.length; i++) {
      const idx = i;
      const entry = sourceStates[idx];

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
            next[idx] = { ...next[idx], phase: 'done', items, classifications };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty: run once on mount

  const allDone = sourceStates.every(
    (s) => s.phase === 'done' || s.phase === 'error',
  );
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
    <div className="alm-setup-scan" data-testid="step-scan">
      {sourceStates.length === 0 ? (
        <p className="alm-setup-scan__empty-msg">{m.setup_scan_no_sources()}</p>
      ) : (
        <>
          {/* Per-source results — scrollable region; expanding accordions scroll here,
              not the whole wizard page. */}
          <div className="alm-setup-scan__scroll">
            {sourceStates.map((s) => (
              <SourceSummary key={s.source.path} state={s} />
            ))}
          </div>

          {/* Summary line (shown when all sources are complete) */}
          {allDone && (
            <p data-testid="scan-summary" className="alm-setup-scan__summary">
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
