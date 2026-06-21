/**
 * SessionsList — spec 006, grouped by InventorySource (LibraryRoot).
 *
 * Renders the grouped inventory ledger with source/frame/review filter controls.
 * Each group header shows the source path, kind, and state.
 * Review state is rendered as plain text (no badge bubbles, FR-004).
 */

import { AlertTriangle } from 'lucide-react';
import type { InventorySource, InventorySession } from '@/api/commands';
import { ListSidebar, ListItem } from '@/components';
import { Pill } from '@/ui';
import { sessionStateLabel, sessionStateVariant } from '@/lib/lifecycle';
import type { InventoryFrameFilter, ReviewFilter } from '@/lib/route-contract';
import { INVENTORY_FRAME_FILTERS, REVIEW_FILTERS } from '@/lib/route-contract';

// ── Source-state label helpers ────────────────────────────────────────────────

const SOURCE_STATE_LABELS: Record<string, string> = {
  active: 'active',
  missing: 'missing',
  disabled: 'disabled',
  reconnect_required: 'reconnect required',
};

const SOURCE_KIND_LABELS: Record<string, string> = {
  local_disk: 'local disk',
  external_disk: 'external disk',
  removable: 'removable',
  network_share: 'network share',
};

function sourceMetaLine(src: InventorySource): string {
  const kind = SOURCE_KIND_LABELS[src.kind] ?? src.kind;
  const state = SOURCE_STATE_LABELS[src.state] ?? src.state;
  return src.state === 'active' ? kind : `${kind} · ${state}`;
}

// ── Review-filter display labels ──────────────────────────────────────────────
// UI maps discovered+candidate → "Needs review" per spec 006 §InventorySession.state.

function reviewFilterLabel(v: string): string {
  if (v === 'discovered' || v === 'candidate') return 'Needs review (discovered/candidate)';
  if (v === 'needs_review') return 'Needs review';
  if (v === 'all') return 'All states';
  return sessionStateLabel(v);
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  sources: InventorySource[];
  selected: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  frameFilter?: string;
  reviewFilter?: string;
  onFrameFilter: (v: InventoryFrameFilter | null) => void;
  onReviewFilter: (v: ReviewFilter | null) => void;
}

export function SessionsList({
  sources,
  selected,
  onSelect,
  loading,
  frameFilter,
  reviewFilter,
  onFrameFilter,
  onReviewFilter,
}: Props) {
  const totalSessions = sources.reduce((acc, src) => acc + src.sessions.length, 0);

  return (
    <ListSidebar
      placeholder="Search target, filter, source…"
      controls={
        <>
          {/* Frame type filter — SC-001: one interaction */}
          <select
            value={frameFilter ?? ''}
            onChange={(e) => onFrameFilter((e.target.value as InventoryFrameFilter) || null)}
            aria-label="Frame type filter"
          >
            <option value="">Frame type: all</option>
            {INVENTORY_FRAME_FILTERS.map((ft) => (
              <option key={ft} value={ft}>
                {ft}
              </option>
            ))}
          </select>

          {/* Review state filter */}
          <select
            value={reviewFilter ?? ''}
            onChange={(e) => onReviewFilter((e.target.value as ReviewFilter) || null)}
            aria-label="Review state filter"
          >
            <option value="">Review: default</option>
            {REVIEW_FILTERS.map((rf) => (
              <option key={rf} value={rf}>
                {reviewFilterLabel(rf)}
              </option>
            ))}
          </select>
        </>
      }
      footer={loading ? 'Loading…' : `${totalSessions} sessions`}
    >
      {sources.length === 0 && !loading && (
        <div style={{ padding: 'var(--alm-sp-4)', color: 'var(--alm-text-faint)', fontSize: 'var(--alm-text-sm)' }}>
          No sessions match the current filters.
        </div>
      )}

      {sources.map((src) => (
        <div key={src.id}>
          {/* Group header: source path + kind · state (FR-005, T400) */}
          <div
            style={{
              padding: 'var(--alm-sp-1) var(--alm-sp-3)',
              fontSize: 'var(--alm-text-xs)',
              color: 'var(--alm-text-muted)',
              borderBottom: '1px solid var(--alm-border)',
              background: 'var(--alm-surface-subtle)',
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--alm-text-secondary)' }}>
              {src.path}
            </span>
            {' · '}
            <span>{sourceMetaLine(src)}</span>
            {src.state !== 'active' && (
              <Pill
                variant={src.state === 'disabled' ? 'danger' : 'warn'}
                style={{ marginLeft: 'var(--alm-sp-2)' }}
              >
                {SOURCE_STATE_LABELS[src.state] ?? src.state}
              </Pill>
            )}
          </div>

          {/* Session rows */}
          {src.sessions.map((s: InventorySession) => (
            <ListItem
              key={s.id}
              selected={selected === s.id}
              onClick={() => onSelect(s.id)}
              title={
                <>
                  <strong>{s.target ?? s.name}</strong>
                  {s.filter && <Pill variant="neutral">{s.filter}</Pill>}
                  {(s.state === 'discovered' || s.state === 'candidate') && (
                    <AlertTriangle
                      size={12}
                      role="img"
                      aria-label="Needs review"
                      style={{ color: 'var(--alm-warn)', display: 'inline', verticalAlign: 'middle' }}
                    />
                  )}
                </>
              }
              meta={
                <>
                  {s.capturedOn ?? '—'}
                  <span className="alm-list-item__meta-sep">·</span>
                  {s.frames} frames
                  <span className="alm-list-item__meta-sep">·</span>
                  {/* Plain-text state label — no bubble (FR-004) */}
                  <Pill variant={sessionStateVariant(s.state)}>
                    {s.state === 'discovered' || s.state === 'candidate'
                      ? 'Needs review'
                      : sessionStateLabel(s.state)}
                  </Pill>
                </>
              }
            />
          ))}
        </div>
      ))}
    </ListSidebar>
  );
}
