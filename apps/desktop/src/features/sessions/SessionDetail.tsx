/**
 * SessionDetail — spec 006 wired; spec 043 §4 redesign (task #79/#99/#100).
 * Enriched in task #38: integration stats MetricLine, Optics + Calibration
 * rail cards, per-frame table (task #38), expandable frame rows (task #37),
 * and acquisition history. Layout extended to a three-column grid.
 *
 * Detail panel for an InventorySession. Uses the shared DetailPanel wrapper
 * (task #100) so Sessions and Calibration share one header construct.
 *
 * Density + de-duplication (#99):
 *   The table row already shows: Target, Filter, Frames, Integration (exposure),
 *   Night, Camera, State, Projects. The detail panel MUST NOT repeat those
 *   fields in the title bar or as the primary hero.
 *
 *   - Title: target identity (always the identity anchor; appropriate to repeat
 *     as the selected-item label in the panel header).
 *   - Subtitle: camera · gain · sensor temp — equipment context NOT in the row.
 *   - MetricLine: integration stats (frames / total exposure / integration time)
 *     that summarise the session at a glance and don't duplicate the row columns
 *     because they present derived/formatted values.
 *   - Layout: three-column (facts | optics+state | frames+history):
 *       Left  (~300px) — compact 2-column KV grid of FITS facts.
 *       Mid   (~300px) — optics + calibration + state + linked rail cards.
 *       Right (flex: 1) — per-frame table + acquisition history.
 *     This fits the wide-short ListPageLayout bottom panel.
 *
 * Task #37 — per-frame inspector design decision:
 *   A separate side inspector was REJECTED. Reason: the per-frame DTO carries
 *   only session-level data (not individual file paths/quality/FITS headers),
 *   so a side panel would either fabricate content or repeat the table. Instead
 *   rows are EXPANDABLE — clicking a row reveals session-level acquisition
 *   context for that frame group (type, exposure, capture night, source path
 *   placeholder). When per-frame data is added to the contract, the expanded
 *   row is the correct place to surface it without a second panel.
 *
 * Review actions (Confirm / Re-open / Reject) are CONTEXTUAL — they act on the
 * selected session — so they live in the detail header's actions slot, not the
 * global PageTopBar (task #79). The SessionsPage passes handlers + visibility.
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

// ── Per-frame table ───────────────────────────────────────────────────────────

/** Expanded detail row body — shown when a frame group row is expanded. */
function FrameExpandedBody({ session }: { session: InventorySession }) {
  return (
    <div className="alm-session-frames__expanded-body">
      {/* Path placeholder: individual frame paths are not yet part of the
          InventorySession DTO. When the contract adds per-frame paths, replace
          this placeholder with the actual frame path list. */}
      <span className="alm-session-frames__path-placeholder">
        {session.name} — {session.frames} frame{session.frames !== 1 ? 's' : ''}
      </span>
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
          <dt>Set temp</dt>
          <dd>{session.setTemp ?? '—'}</dd>
        </dl>
      </div>
    </div>
  );
}

/**
 * Per-frame table rendered as a native <table> so that the expanded row can
 * span all columns via colSpan. The shared <Table> component iterates columns
 * one-to-one and cannot produce a colspan row — this bespoke table is the
 * correct choice here.
 *
 * The InventorySession DTO represents one acquisition session as a single
 * logical group (not individual frame records). We therefore produce one summary
 * row per session. When per-frame records are added to the contract, each record
 * becomes one row. The toggle column drives the expandable-row pattern (task #37).
 */
function SessionFramesTable({
  session,
  expandedRows,
  onToggle,
}: {
  session: InventorySession;
  expandedRows: Set<string>;
  onToggle: (key: string) => void;
}) {
  const isExpanded = expandedRows.has(session.id);
  return (
    <table className="alm-table" aria-label="Session frames">
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
            isExpanded ? 'alm-session-frames__row--expanded' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onToggle(session.id)}
        >
          <td>
            <span className="alm-session-frames__toggle" aria-hidden="true">
              {isExpanded ? '▾' : '▸'}
            </span>
          </td>
          <td>{session.type ?? '—'}</td>
          <td>{String(session.frames)}</td>
          <td>{session.exposure ?? '—'}</td>
          <td>{session.filter ?? '—'}</td>
          <td>{session.capturedOn ?? '—'}</td>
        </tr>
        {isExpanded && (
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
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (key: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

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

  // Integration stats for the MetricLine — derived, not a raw DTO repeat.
  const totalSec = integrationSeconds(session);
  const integrationLabel = totalSec != null ? fmtSeconds(totalSec) : '—';

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
    >
      {/* Integration stats MetricLine — derived values, not row-column repeats.
          "Total integration" is frames×exposure which isn't shown in the row. */}
      <MetricLine
        metrics={[
          { value: String(session.frames), label: 'frames' },
          { value: session.exposure ?? '—', label: 'per frame' },
          { value: integrationLabel, label: 'total integration' },
        ]}
      />

      {/* Three-column body grid (task #38).
          See .cssblocks/sessions-detail.css for layout rules. */}
      <div className="alm-session-detail alm-session-detail--rich">

        {/* ── Facts column ── */}
        <aside className="alm-session-detail__facts">
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
        </aside>

        {/* ── Mid column: optics + calibration + state + linked ── */}
        <div className="alm-session-detail__mid">
          <div className="alm-rail__panel">
            {/* Optics — telescope/focal length/pixel scale.
                These fields are not yet part of the InventorySession DTO.
                Shown as placeholders to set the layout; values will be wired
                when the backend contract adds optics metadata. */}
            <RailCard title="Optics">
              <div className="alm-session-detail__kvgrid">
                <KV label="Telescope" value="—" />
                <KV label="Focal length" value="—" />
                <KV label="Pixel scale" value="—" />
              </div>
            </RailCard>

            {/* Calibration matches — not yet in the InventorySession DTO.
                Placeholder shown; will be wired when calibration.match.suggest
                is anchored to session IDs in the sessions surface. */}
            <RailCard title="Calibration matches">
              <div className="alm-session-detail__kvgrid">
                <KV label="Darks" value="—" />
                <KV label="Flats" value="—" />
                <KV label="Bias" value="—" />
              </div>
            </RailCard>

            {/* FR-004: state as read-only structured data; actions live in the header */}
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
        </div>

        {/* ── Main column: per-frame table + acquisition history ── */}
        <div className="alm-session-detail__main">
          {/* Per-frame table (task #38 / #37).
              Each row represents one acquisition group (session-level granularity
              until the contract adds per-frame records). Rows are expandable
              (task #37) to reveal additional session acquisition context.
              A separate inspector panel was rejected — see file header comment. */}
          <div className="alm-session-frames">
            <SessionFramesTable
              session={session}
              expandedRows={expandedRows}
              onToggle={toggleRow}
            />
          </div>

          {/* Acquisition history — session name, source, and capture context.
              Shows the provenance chain for this session's raw data. */}
          <div className="alm-session-history">
            <div className="alm-session-history__title">Acquisition history</div>
            <div className="alm-session-history__row">
              <div className="alm-session-history__item">
                <span className="alm-session-history__item-label">Session</span>
                <span className="alm-session-history__item-value">{session.name}</span>
              </div>
              <div className="alm-session-history__item">
                <span className="alm-session-history__item-label">Captured</span>
                <span className="alm-session-history__item-value">
                  {session.capturedOn ?? '—'}
                </span>
              </div>
              <div className="alm-session-history__item">
                <span className="alm-session-history__item-label">Type</span>
                <span className="alm-session-history__item-value">
                  {session.type ?? '—'}
                </span>
              </div>
              {prov?.inferred && (
                <div className="alm-session-history__item">
                  <span className="alm-session-history__item-label">Note</span>
                  <span className="alm-session-history__item-value">{prov.inferred}</span>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </DetailPanel>
  );
}
