/**
 * SessionDetail — spec 006 wired; spec 043 §4 redesign (task #79/#99/#100).
 *
 * Uses the canonical DetailPanel with the `facts` prop so the FITS facts KV
 * sits in the pinned left column (non-scrolling) and the frames table + review
 * state + linked projects sit in the scrolling right content column — matching
 * the unified two-column contract shared with MasterDetail.
 *
 * Density + de-duplication (#99):
 *   The table row already shows: Target, Filter, Frames, Integration (exposure),
 *   Night, Camera, State, Projects. The detail panel MUST NOT repeat those
 *   fields in the title bar or as the primary hero.
 *
 *   - Title: target identity (always the identity anchor; appropriate to repeat
 *     as the selected-item label in the panel header).
 *   - Subtitle: camera · gain · sensor temp — equipment context NOT in the row.
 *   - MetricLine: total integration (derived frames×exposure) — compact, non-
 *     duplicative since the raw per-frame exposure is in the row but the total
 *     is not.
 *   - facts: compact 2-col KV grid (left, fixed width, no scroll).
 *   - children: frames table + review state + linked projects (right, scrolls).
 *     Optics and calibration matches are suppressed while entirely "—" to avoid
 *     large empty cards.
 *
 * Task #37 — per-frame expandable rows:
 *   Rows are EXPANDABLE inline — clicking reveals camera/gain/binning/temp
 *   which are NOT columns in SessionsTable. When the contract adds per-frame
 *   records the expanded row is the right place to surface them without
 *   structural change.
 *
 * Review actions (Confirm / Re-open / Reject) are CONTEXTUAL — they act on the
 * selected session — so they live in the detail header's actions slot, not the
 * global PageTopBar (task #79).
 *
 * Provenance is surfaced inline via the Facts KV provenance label (inferred vs
 * FITS-extracted). A separate Provenance section is not needed.
 *
 * SC-004: no column is named Tags or Handling.
 * FR-004: state renders as plain structured data, not a decorative bubble.
 */

import { useState } from 'react';
import type { InventorySession } from '@/api/commands';
import {
  DetailPane,
  DetailPanel,
  MetricLine,
  RailCard,
} from '@/components';
import { Pill, EmptyState, Lock, KV, Btn } from '@/ui';
import { sessionStateLabel, sessionStateVariant } from '@/lib/lifecycle';

interface Props {
  session: InventorySession | null;
  /** Contextual review-action handlers (act on this session). */
  onConfirm?: () => void;
  onReopen?: () => void;
  onReject?: () => void;
  /** Action visibility — driven by the session's canonical state on the page. */
  confirmVisible?: boolean;
  reopenVisible?: boolean;
  rejectVisible?: boolean;
  /** A review mutation is in flight for this session. */
  pending?: boolean;
}

/**
 * Equipment context subtitle: camera · gain · sensor temp.
 * Shows fields NOT already visible in the table row (which shows Target,
 * Filter, Frames, Integration, Night, Camera, State, Projects). We include
 * Camera here too as the subtitle anchor — it provides identity context when
 * the panel is open, even though the row shows it.
 */
function equipmentSubtitle(session: InventorySession): string {
  const parts: string[] = [];
  if (session.camera) parts.push(session.camera);
  if (session.gain) parts.push(`g${session.gain}`);
  if (session.setTemp) parts.push(session.setTemp);
  if (session.binning) parts.push(session.binning);
  return parts.join(' · ');
}

/**
 * Derive total integration seconds from frames × per-frame exposure.
 * Returns null when exposure is missing or unparseable.
 */
function integrationSeconds(session: InventorySession): number | null {
  if (!session.exposure) return null;
  // Exposure strings are like "300s", "300.5s", "195s" — strip the trailing 's'.
  const raw = session.exposure.replace(/s$/i, '');
  const secs = parseFloat(raw);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return secs * session.frames;
}

function fmtSeconds(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Per-frame expandable table (task #37) ─────────────────────────────────────
//
// Bespoke native <table> so the expanded row can use colSpan. The shared
// <Table> component iterates columns 1-to-1 and cannot produce a colspan row.
//
// The InventorySession DTO has one logical group per session (not individual
// frame records), so we render one summary row. The expanded body surfaces
// camera/gain/binning/temp — NOT shown in SessionsTable columns.

function FrameExpandedBody({ session }: { session: InventorySession }) {
  return (
    <div className="alm-session-frames__expanded-body">
      {/* Session name is the file-group identifier. Individual file paths are
          not yet in the InventorySession DTO; replace with per-frame paths
          when the contract adds them. */}
      <span className="alm-session-frames__path-placeholder">{session.name}</span>
      <div className="alm-session-frames__expanded-kvrow">
        <dl className="alm-session-frames__expanded-kv">
          <dt>Camera</dt>
          <dd>{session.camera ?? '—'}</dd>
        </dl>
        <dl className="alm-session-frames__expanded-kv">
          <dt>Gain</dt>
          <dd>{session.gain ?? '—'}</dd>
        </dl>
        <dl className="alm-session-frames__expanded-kv">
          <dt>Binning</dt>
          <dd>{session.binning ?? '—'}</dd>
        </dl>
        <dl className="alm-session-frames__expanded-kv">
          <dt>Sensor temp</dt>
          <dd>{session.setTemp ?? '—'}</dd>
        </dl>
      </div>
    </div>
  );
}

function SessionFramesTable({ session }: { session: InventorySession }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <table className="alm-table alm-session-frames__table" aria-label="Frame group">
      <thead>
        <tr>
          <th className="alm-session-frames__th-toggle" />
          <th>Type</th>
          <th>Frames</th>
          <th>Exp.</th>
          <th>Filter</th>
          <th>Night</th>
        </tr>
      </thead>
      <tbody>
        <tr
          className={[
            'alm-session-frames__row',
            expanded ? 'alm-session-frames__row--expanded' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => setExpanded((v) => !v)}
        >
          <td>
            <span className="alm-session-frames__toggle" aria-hidden="true">
              {expanded ? '▾' : '▸'}
            </span>
          </td>
          <td>{session.type ?? '—'}</td>
          <td>{String(session.frames)}</td>
          <td>{session.exposure ?? '—'}</td>
          <td>{session.filter ?? '—'}</td>
          <td>{session.capturedOn ?? '—'}</td>
        </tr>
        {expanded && (
          <tr className="alm-session-frames__expanded-row">
            <td colSpan={6}>
              <FrameExpandedBody session={session} />
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SessionDetail({
  session,
  onConfirm,
  onReopen,
  onReject,
  confirmVisible = false,
  reopenVisible = false,
  rejectVisible = false,
  pending = false,
}: Props) {
  if (!session) {
    return (
      <DetailPane>
        <EmptyState
          title="Select a session"
          desc="Choose a session from the list to view its details."
        />
      </DetailPane>
    );
  }

  const isLinked = (session.linked?.projects?.length ?? 0) > 0;

  // Provenance: if a value was inferred, surface it via the KV provenance label.
  const prov = session.provenance;
  const targetProv = prov?.target ? 'Inferred' : 'FITS';
  const filterProv = prov?.filter ? 'Inferred' : 'FITS';

  // Total integration is derived (frames×exposure) — NOT a raw row-column repeat.
  const totalSec = integrationSeconds(session);
  const integrationLabel = totalSec != null ? fmtSeconds(totalSec) : null;

  // Facts column: compact 2-col KV grid (left, pinned, no scroll).
  // Uses the existing alm-session-detail__kvgrid density rules.
  const facts = (
    <div className="alm-rail__panel">
      <RailCard title="Facts">
        <div className="alm-session-detail__kvgrid">
          <KV label="Target" value={session.target ?? '—'} provenance={targetProv} />
          <KV label="Filter" value={session.filter ?? '—'} provenance={filterProv} />
          <KV label="Frames" value={String(session.frames)} />
          <KV label="Exposure" value={session.exposure ?? '—'} />
          <KV label="Night" value={session.capturedOn ?? '—'} />
          <KV label="Camera" value={session.camera ?? '—'} />
          <KV label="Gain" value={session.gain ?? '—'} />
          <KV label="Binning" value={session.binning ?? '—'} />
          {session.setTemp && <KV label="Sensor temp" value={session.setTemp} />}
          {prov?.confirmedBy && (
            <KV label="Confirmed by" value={prov.confirmedBy} provenance="User" />
          )}
        </div>
      </RailCard>
    </div>
  );

  // Aux column (right): review state + linked projects + calibration links.
  const auxColumn = (
    <div className="alm-rail__panel">
      {/* FR-004: state as read-only structured data; actions live in header */}
      <RailCard title="Review state">
        <Pill variant={sessionStateVariant(session.state)}>
          {session.state === 'discovered' || session.state === 'candidate'
            ? 'Needs review'
            : sessionStateLabel(session.state)}
        </Pill>
      </RailCard>

      <RailCard title="Linked projects">
        {isLinked ? (
          <div className="alm-session-detail__linked-pills">
            {session.linked?.projects?.map((p) => (
              <Pill key={p.id} variant="info">
                {p.name}
              </Pill>
            ))}
          </div>
        ) : (
          <span className="alm-session-detail__no-linked">None</span>
        )}
      </RailCard>

      {(session.linked?.calibration != null || session.linked?.session != null) && (
        <RailCard title="Linked">
          {session.linked?.session && (
            <KV label="Session" value={session.linked.session} />
          )}
          {session.linked?.calibration && (
            <KV label="Calibration" value={session.linked.calibration} />
          )}
        </RailCard>
      )}
    </div>
  );

  return (
    <DetailPanel
      variant="sessions"
      title={
        <span className="alm-session-detail__heading">
          {isLinked && (
            <Lock reason="Linked to a project — metadata locked while in use." />
          )}
          <strong>{session.target ?? session.name}</strong>
        </span>
      }
      subtitle={equipmentSubtitle(session) || undefined}
      actions={
        <>
          {confirmVisible && (
            <Btn size="sm" variant="primary" onClick={onConfirm} disabled={pending}>
              Confirm
            </Btn>
          )}
          {reopenVisible && (
            <Btn size="sm" onClick={onReopen} disabled={pending}>
              Re-open review
            </Btn>
          )}
          {rejectVisible && (
            <Btn size="sm" variant="danger" onClick={onReject} disabled={pending}>
              Reject
            </Btn>
          )}
        </>
      }
      facts={facts}
      aux={auxColumn}
    >
      {/* Content column (center, scrolls): frames table.
          Total integration shown as a compact MetricLine above the table. */}
      <div className="alm-session-detail__content alm-rail__panel">
        {integrationLabel != null && (
          <MetricLine
            metrics={[
              { value: String(session.frames), label: 'frames' },
              { value: session.exposure ?? '—', label: 'per frame' },
              { value: integrationLabel, label: 'total integration' },
            ]}
          />
        )}

        {/* Per-frame table (task #37/#38). One summary row; click to expand
            camera/gain/binning/temp — fields not in the SessionsTable columns. */}
        <RailCard title="Frames">
          <SessionFramesTable session={session} />
        </RailCard>
      </div>
    </DetailPanel>
  );
}
