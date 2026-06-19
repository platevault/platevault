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

  const totalItems = items.length;
  const totalFiles = items.reduce((acc, it) => acc + it.fileCount, 0);

  // Aggregate breakdown counts across all classified items
  const kindCounts = new Map<string, number>();
  for (const [, cls] of classifications) {
    for (const entry of cls.breakdown ?? []) {
      kindCounts.set(entry.kind, (kindCounts.get(entry.kind) ?? 0) + entry.count);
    }
  }

  return (
    <div
      data-testid={`scan-source-${source.path}`}
      style={{
        border: '1px solid var(--alm-border)',
        borderRadius: 'var(--alm-radius-md)',
        padding: 'var(--alm-sp-4)',
        marginBottom: 'var(--alm-sp-3)',
        background: 'var(--alm-surface)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-3)', marginBottom: 'var(--alm-sp-2)' }}>
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
        <Pill variant={phasePillVariant(phase)}>{phaseLabel(phase)}</Pill>
      </div>

      {/* Kind label */}
      <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', marginBottom: 'var(--alm-sp-2)' }}>
        {source.kind.replace('_', ' ')}
      </div>

      {/* Error state */}
      {phase === 'error' && error && (
        <p style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-error)', margin: 0 }}>
          {error}
        </p>
      )}

      {/* Scanning state */}
      {phase === 'scanning' && (
        <p style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-secondary)', margin: 0 }}>
          Scanning…
        </p>
      )}

      {/* Done: empty state */}
      {phase === 'done' && totalItems === 0 && (
        <p
          data-testid="scan-empty"
          style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)', margin: 0 }}
        >
          Nothing detected in this folder.
        </p>
      )}

      {/* Done: detection summary */}
      {phase === 'done' && totalItems > 0 && (
        <div>
          <div style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-secondary)', marginBottom: 'var(--alm-sp-2)' }}>
            {totalItems} folder{totalItems !== 1 ? 's' : ''} detected
            {totalFiles > 0 ? ` · ${totalFiles} file${totalFiles !== 1 ? 's' : ''}` : ''}
          </div>
          {kindCounts.size > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--alm-sp-2)' }}>
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
          {/* List inbox items using a compact format (reusing InboxItemSummary data) */}
          <div style={{ marginTop: 'var(--alm-sp-3)' }}>
            {items.map((item) => (
              <div
                key={item.inboxItemId}
                data-testid={`scan-item-${item.inboxItemId}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--alm-sp-2)',
                  padding: 'var(--alm-sp-1) 0',
                  fontSize: 'var(--alm-text-xs)',
                  color: 'var(--alm-text-secondary)',
                  borderTop: '1px solid var(--alm-border-subtle)',
                }}
              >
                <span style={{ flex: 1, wordBreak: 'break-all' }}>{item.relativePath}</span>
                <span>{item.fileCount} file{item.fileCount !== 1 ? 's' : ''}</span>
                <Pill variant="neutral">{item.lane.toUpperCase()}</Pill>
              </div>
            ))}
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
export function StepScan({ sources, flushResult, onFinish, isFinishing }: StepScanProps) {
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
    <div className="alm-step-scan" data-testid="step-scan">
      {sourceStates.length === 0 ? (
        <p style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)' }}>
          No sources registered. Go back and add at least one folder.
        </p>
      ) : (
        <>
          {/* Per-source results */}
          <div style={{ marginBottom: 'var(--alm-sp-4)' }}>
            {sourceStates.map((s) => (
              <SourceSummary key={s.source.path} state={s} />
            ))}
          </div>

          {/* Summary footer (shown when all sources are complete) */}
          {allDone && (
            <p
              data-testid="scan-summary"
              style={{
                fontSize: 'var(--alm-text-sm)',
                color: 'var(--alm-text-secondary)',
                margin: 0,
              }}
            >
              {totalDetected > 0
                ? `${totalDetected} folder${totalDetected !== 1 ? 's' : ''} detected across all sources. Head to the Inbox to review and approve.`
                : 'No folders detected. You can add more sources in Settings.'}
            </p>
          )}
        </>
      )}

      {/* Finish button — always visible, enabled once all scans complete */}
      <div style={{ marginTop: 'var(--alm-sp-5)' }}>
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
