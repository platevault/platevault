// First-run wizard: "Scan" step (spec 038).
//
// Registers sources (via flushToDB), then runs inbox_scan_folder +
// inbox_classify per source, showing per-source progress and a detection
// summary.  Approval stays in the Inbox — no inbox_confirm called here.

import { useEffect, useRef, useState } from 'react';
import { Pill } from '@/ui/Pill';
import type { PillVariant } from '@/ui/Pill';
import { inboxScanFolder, inboxClassify } from '@/api/commands';
import type { InboxItemSummary, InboxClassifyResponse } from '@/api/commands';
import type { SourceEntry } from '../sources-store';
import type { FlushResult } from '../sources-store';

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
  /** Callback when scan step is done and Finish is clicked. */
  onFinish: () => Promise<void>;
  isFinishing: boolean;
  /** Go back to the review step to correct sources, then re-scan. */
  onBack: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function phaseLabel(phase: ScanPhase): string {
  switch (phase) {
    case 'pending':
      return 'Pending';
    case 'scanning':
      return 'Scanning…';
    case 'done':
      return 'Done';
    case 'error':
      return 'Error';
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
  const { source, phase, items, classifications, error } = state;
  const [expanded, setExpanded] = useState(false);

  const totalItems = items.length;
  const totalFiles = items.reduce((acc, it) => acc + it.fileCount, 0);

  // Aggregate breakdown counts across all classified items
  const kindCounts = new Map<string, number>();
  for (const [, cls] of classifications) {
    for (const entry of cls.breakdown ?? []) {
      kindCounts.set(entry.kind, (kindCounts.get(entry.kind) ?? 0) + entry.count);
    }
  }

  // Stable sort for the table: by lane, then folder path.
  const sortedItems = [...items].sort(
    (a, b) => a.lane.localeCompare(b.lane) || a.relativePath.localeCompare(b.relativePath),
  );
  const cell = { padding: 'var(--alm-sp-1) var(--alm-sp-2)', textAlign: 'left' } as const;

  // The detail panel (chips + table) is expandable only when scan is done and
  // there are items to show.
  const isExpandable = phase === 'done' && totalItems > 0;

  // Compact count summary for the always-visible header line.
  const countSummary =
    phase === 'done' && totalItems > 0
      ? `${totalItems} folder${totalItems !== 1 ? 's' : ''} · ${totalFiles} file${totalFiles !== 1 ? 's' : ''}`
      : null;

  return (
    <div
      data-testid={`scan-source-${source.path}`}
      style={{
        border: '1px solid var(--alm-border)',
        borderRadius: 'var(--alm-radius-md)',
        marginBottom: 'var(--alm-sp-3)',
        background: 'var(--alm-surface)',
        overflow: 'hidden',
      }}
    >
      {/* ── Always-visible header row ─────────────────────────────────────── */}
      <div
        role={isExpandable ? 'button' : undefined}
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
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--alm-sp-3)',
          padding: 'var(--alm-sp-4)',
          cursor: isExpandable ? 'pointer' : 'default',
          userSelect: 'none',
        }}
      >
        {/* Chevron — only shown when expandable */}
        {isExpandable && (
          <span
            aria-hidden="true"
            style={{
              fontSize: 'var(--alm-text-xs)',
              color: 'var(--alm-text-muted)',
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            {expanded ? '▾' : '▸'}
          </span>
        )}

        {/* Source path */}
        <span
          style={{
            flex: 1,
            fontWeight: 'var(--alm-weight-medium)',
            fontSize: 'var(--alm-text-sm)',
            color: 'var(--alm-text)',
            wordBreak: 'break-all',
          }}
        >
          {source.path}
        </span>

        {/* Kind label (muted, small) */}
        <span
          style={{
            fontSize: 'var(--alm-text-xs)',
            color: 'var(--alm-text-muted)',
            flexShrink: 0,
          }}
        >
          {source.kind.replace('_', ' ')}
        </span>

        {/* Compact count summary */}
        {countSummary && (
          <span
            style={{
              fontSize: 'var(--alm-text-xs)',
              color: 'var(--alm-text-secondary)',
              flexShrink: 0,
            }}
          >
            {countSummary}
          </span>
        )}

        {/* Phase pill */}
        <Pill variant={phasePillVariant(phase)}>{phaseLabel(phase)}</Pill>
      </div>

      {/* ── Always-visible transient states (below header, outside collapse) ── */}
      {/* These are small/short and don't benefit from collapse. */}
      {phase === 'error' && error && (
        <p
          style={{
            fontSize: 'var(--alm-text-sm)',
            color: 'var(--alm-text-error)',
            margin: 0,
            padding: '0 var(--alm-sp-4) var(--alm-sp-4)',
          }}
        >
          {error}
        </p>
      )}

      {phase === 'scanning' && (
        <p
          style={{
            fontSize: 'var(--alm-text-sm)',
            color: 'var(--alm-text-secondary)',
            margin: 0,
            padding: '0 var(--alm-sp-4) var(--alm-sp-4)',
          }}
        >
          Scanning…
        </p>
      )}

      {phase === 'done' && totalItems === 0 && (
        <p
          data-testid="scan-empty"
          style={{
            fontSize: 'var(--alm-text-sm)',
            color: 'var(--alm-text-muted)',
            margin: 0,
            padding: '0 var(--alm-sp-4) var(--alm-sp-4)',
          }}
        >
          Nothing detected in this folder.
        </p>
      )}

      {/* ── Collapsible detail panel (chips + table) ─────────────────────── */}
      {isExpandable && expanded && (
        <div style={{ padding: '0 var(--alm-sp-4) var(--alm-sp-4)' }}>
          {/* Kind-count chips */}
          {kindCounts.size > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 'var(--alm-sp-2)',
                marginBottom: 'var(--alm-sp-3)',
              }}
            >
              {Array.from(kindCounts.entries()).map(([kind, count]) => (
                <span
                  key={kind}
                  style={{
                    fontSize: 'var(--alm-text-xs)',
                    background: 'var(--alm-surface-alt)',
                    border: '1px solid var(--alm-border)',
                    borderRadius: 'var(--alm-radius-sm)',
                    padding: '2px var(--alm-sp-2)',
                    color: 'var(--alm-text-secondary)',
                  }}
                >
                  {count} {kind}
                </span>
              ))}
            </div>
          )}

          {/* Scrollable metadata table of detected ingestion groups */}
          <div
            style={{
              maxHeight: 280,
              overflowY: 'auto',
              border: '1px solid var(--alm-border-subtle)',
              borderRadius: 'var(--alm-radius-sm)',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 'var(--alm-text-xs)',
                color: 'var(--alm-text-secondary)',
              }}
            >
              <thead>
                <tr
                  style={{
                    position: 'sticky',
                    top: 0,
                    background: 'var(--alm-surface-raised)',
                    color: 'var(--alm-text)',
                  }}
                >
                  <th style={cell}>Folder</th>
                  <th style={cell}>Files</th>
                  <th style={cell}>Extension</th>
                  <th style={cell}>Detected types</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((item) => {
                  const breakdown = classifications.get(item.inboxItemId)?.breakdown ?? [];
                  const types = breakdown.map((b) => `${b.count} ${b.kind}`).join(', ');
                  return (
                    <tr
                      key={item.inboxItemId}
                      data-testid={`scan-item-${item.inboxItemId}`}
                      style={{ borderTop: '1px solid var(--alm-border-subtle)' }}
                    >
                      <td style={{ ...cell, wordBreak: 'break-all' }}>{item.relativePath}</td>
                      <td style={cell}>{item.fileCount}</td>
                      <td style={cell}>{item.lane.toUpperCase()}</td>
                      <td style={cell}>{types || '—'}</td>
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
 */
export function StepScan({ sources, flushResult, onFinish, isFinishing, onBack }: StepScanProps) {
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

      (async () => {
        // Mark as scanning
        setSourceStates((prev) => {
          const next = [...prev];
          next[idx] = { ...next[idx], phase: 'scanning' };
          return next;
        });

        try {
          // 1. Scan the folder
          const scanResponse = await inboxScanFolder({
            rootId: entry.rootId,
            rootAbsolutePath: entry.source.path,
          });

          const items = scanResponse.items ?? [];

          // 2. Classify each discovered item
          const classifications = new Map<string, InboxClassifyResponse>();
          await Promise.allSettled(
            items.map(async (item) => {
              try {
                const cls = await inboxClassify({
                  inboxItemId: item.inboxItemId,
                  rootAbsolutePath: entry.source.path,
                });
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
              error: err instanceof Error ? err.message : String(err),
            };
            return next;
          });
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty: run once on mount

  const allDone = sourceStates.every((s) => s.phase === 'done' || s.phase === 'error');
  const totalDetected = sourceStates.reduce((acc, s) => acc + s.items.length, 0);

  return (
    <div
      className="alm-step-scan"
      data-testid="step-scan"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      {sourceStates.length === 0 ? (
        <p style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>
          No sources registered. Go back and add at least one folder.
        </p>
      ) : (
        <>
          {/* Per-source results — scrollable region; expanding accordions scroll here,
              not the whole wizard page. */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            {sourceStates.map((s) => (
              <SourceSummary key={s.source.path} state={s} />
            ))}
          </div>

          {/* Summary line (shown when all sources are complete) */}
          {allDone && (
            <p
              data-testid="scan-summary"
              style={{
                fontSize: 'var(--alm-text-sm)',
                color: 'var(--alm-text-secondary)',
                margin: 'var(--alm-sp-3) 0 0',
                flexShrink: 0,
              }}
            >
              {totalDetected > 0
                ? `${totalDetected} folder${totalDetected !== 1 ? 's' : ''} detected across all sources. Head to the Inbox to review and approve.`
                : 'No folders detected. You can add more sources in Settings.'}
            </p>
          )}
        </>
      )}

      {/* Back / Finish — pinned footer, never scrolls off-screen */}
      <div
        style={{
          flexShrink: 0,
          marginTop: 'var(--alm-sp-4)',
          paddingTop: 'var(--alm-sp-4)',
          borderTop: '1px solid var(--alm-border)',
          display: 'flex',
          gap: 'var(--alm-sp-3)',
        }}
      >
        <button
          data-testid="back-button"
          onClick={onBack}
          disabled={isFinishing}
          style={{
            padding: 'var(--alm-sp-2) var(--alm-sp-5)',
            background: 'transparent',
            color: 'var(--alm-text)',
            border: '1px solid var(--alm-border)',
            borderRadius: 'var(--alm-radius-md)',
            fontWeight: 'var(--alm-weight-medium)',
            fontSize: 'var(--alm-text-sm)',
            cursor: isFinishing ? 'not-allowed' : 'pointer',
            opacity: isFinishing ? 0.6 : 1,
          }}
        >
          &larr; Back to review
        </button>
        <button
          data-testid="finish-button"
          onClick={() => { void onFinish(); }}
          disabled={isFinishing || !allDone}
          style={{
            padding: 'var(--alm-sp-2) var(--alm-sp-5)',
            background: 'var(--alm-accent)',
            color: 'var(--alm-accent-text)',
            border: 'none',
            borderRadius: 'var(--alm-radius-md)',
            fontWeight: 'var(--alm-weight-medium)',
            fontSize: 'var(--alm-text-sm)',
            cursor: isFinishing || !allDone ? 'not-allowed' : 'pointer',
            opacity: isFinishing || !allDone ? 0.6 : 1,
          }}
        >
          {isFinishing ? 'Finishing…' : 'Finish'}
        </button>
      </div>
    </div>
  );
}
