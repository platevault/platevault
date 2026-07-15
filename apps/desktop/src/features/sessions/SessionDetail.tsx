// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SessionDetail — clean tabular session detail (spec 043 §4 redesign).
 *
 * The session's attributes render as a flat PropertyTable (Property | Value |
 * Source) spread across two columns inside the canonical DetailPanel. Linked
 * projects sit below with a clickable link per project.
 *
 * The per-frame frames table + review-state pill were removed: a session is a
 * single frame-type group, so the frames table only duplicated the row data;
 * the freed space lets the attribute table use both columns.
 *
 * Spec 041 FR-051 (T076, Phase 13): the Confirm/Re-open/Reject/Ignore review
 * actions were removed — sessions are derived, already-confirmed inventory
 * with no review lifecycle. Session metadata remains editable post-hoc via
 * the inbox per-file metadata/override tables. The Reveal action (FR-007) is
 * unrelated to the review lifecycle and is retained.
 */

import type {
  InventorySession,
  SessionCalibrationMatch,
} from '@/bindings/index';
import {
  DetailPane,
  DetailPanel,
  PropertyTable,
  type PropertyDef,
} from '@/components';
import { EmptyState, Btn, Section, Pill } from '@/ui';
import { m } from '@/lib/i18n';
import { revealLabel } from '@/lib/reveal-label';
import { SessionFrameInventory } from './SessionFrameInventory';
import { SessionNotesSection } from './SessionNotesSection';
import { RawFrameCleanupSection } from './RawFrameCleanupSection';

/** Read-only calibration-linkage list (#772). Renders an explicit
 * "no calibration match" state when a light session has no assignment yet
 * (and for calibration sessions, which never carry assignments). */
function CalibrationLinkage({
  matches,
}: {
  matches: SessionCalibrationMatch[];
}) {
  if (matches.length === 0) {
    return (
      <EmptyState
        title={m.sessions_calib_none()}
        desc={m.sessions_calib_none_desc()}
        data-testid="session-calib-empty"
      />
    );
  }
  return (
    <div
      className="alm-session-detail2__linked-list"
      data-testid="session-calib-list"
    >
      {matches.map((match) => (
        <div
          key={`${match.kind}-${match.masterId}`}
          className="alm-session-detail2__calib-row"
        >
          <Pill variant="info">{match.kind}</Pill>
          <span className="alm-mono">{match.masterId}</span>
          {match.score != null && (
            <span className="alm-session-detail2__calib-note">
              {m.sessions_calib_score({ pct: Math.round(match.score * 100) })}
            </span>
          )}
          {match.softMismatches.length > 0 && (
            <span className="alm-session-detail2__calib-note">
              {m.sessions_calib_soft_mismatch({
                dims: match.softMismatches.join(', '),
              })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

interface Props {
  session: InventorySession | null;
  /** Open the session's source location in the OS file browser (FR-007). */
  onReveal?: () => void;
  /** Whether the source path is known so Reveal can be offered (FR-007). */
  revealVisible?: boolean;
  /** Open a linked project — wired by the page to navigation. */
  onOpenProject?: (projectId: string) => void;
}

/** Equipment context subtitle: camera · gain · sensor temp · binning. */
function equipmentSubtitle(session: InventorySession): string {
  const parts: string[] = [];
  if (session.camera) parts.push(session.camera);
  if (session.gain) parts.push(`g${session.gain}`);
  if (session.setTemp) parts.push(session.setTemp);
  if (session.binning) parts.push(session.binning);
  return parts.join(' · ');
}

/** Derive total integration seconds from frames × per-frame exposure. */
function integrationSeconds(session: InventorySession): number | null {
  if (!session.exposure) return null;
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

// ── Component ─────────────────────────────────────────────────────────────────

export function SessionDetail({
  session,
  onReveal,
  revealVisible = false,
  onOpenProject,
}: Props) {
  if (!session) {
    return (
      <DetailPane>
        <EmptyState
          title={m.sessions_select_title()}
          desc={m.sessions_select_desc()}
        />
      </DetailPane>
    );
  }

  const isLinked = (session.linked?.projects?.length ?? 0) > 0;
  const prov = session.provenance;
  const totalSec = integrationSeconds(session);
  const integrationLabel = totalSec != null ? fmtSeconds(totalSec) : null;

  // Session facts as a clean tabular PropertyTable, spread across two columns.
  const factProps: PropertyDef[] = [
    {
      key: 'target',
      label: m.projects_create_target_label(),
      value: session.target ?? null,
      source: prov?.target ? 'inferred' : 'fits',
    },
    {
      key: 'filter',
      label: m.common_filter(),
      value: session.filter ?? null,
      source: prov?.filter ? 'inferred' : 'fits',
    },
    {
      key: 'frames',
      label: m.projects_wizard_col_frames(),
      value: session.frames,
    },
    {
      key: 'exposure',
      label: m.calibration_fp_exposure(),
      value: session.exposure ?? null,
      source: 'fits',
    },
    ...(integrationLabel != null
      ? [
          {
            key: 'integration',
            label: m.sessions_col_total_integration(),
            value: integrationLabel,
          } as PropertyDef,
        ]
      : []),
    {
      key: 'night',
      label: m.sessions_col_night(),
      value: session.capturedOn ?? null,
      source: 'fits',
    },
    {
      key: 'camera',
      label: m.settings_calmatch_camera(),
      value: session.camera ?? null,
      source: 'fits',
    },
    {
      key: 'gain',
      label: m.settings_calmatch_gain(),
      value: session.gain ?? null,
      source: 'fits',
    },
    {
      key: 'binning',
      label: m.settings_calmatch_binning(),
      value: session.binning ?? null,
      source: 'fits',
    },
    {
      // Applicable to every light session (data-model.md matrix) — always
      // present so an absent value renders the unresolved chip (spec-030
      // Q16 / FR-135) instead of silently vanishing.
      key: 'temp',
      label: m.settings_calmatch_sensor_temp(),
      value: session.setTemp ?? null,
      source: 'fits',
    },
    ...(prov?.confirmedBy
      ? [
          {
            key: 'confirmedby',
            label: m.sessions_col_confirmed_by(),
            value: prov.confirmedBy,
            source: 'user',
          } as PropertyDef,
        ]
      : []),
  ];

  const mid = Math.ceil(factProps.length / 2);
  const colA = factProps.slice(0, mid);
  const colB = factProps.slice(mid);

  // The Reveal action sits inline with the title (left-grouped) so growing
  // the panel only adds trailing whitespace — it never spreads the title and
  // button apart. Spec 041 FR-051 (T076): the review actions that used to
  // share this row (Confirm/Re-open/Reject/Ignore) are removed.
  const actionButtons = (
    <span className="alm-session-detail2__actions">
      {/* Platform-native label via the shared revealLabel() helper;
          the title keeps the descriptive what-it-does tooltip. */}
      {revealVisible && (
        <Btn size="sm" onClick={onReveal} title={m.sessions_reveal_title()}>
          {revealLabel()}
        </Btn>
      )}
    </span>
  );

  return (
    <DetailPanel
      variant="sessions"
      title={<strong>{session.target ?? session.name}</strong>}
      titleExtra={actionButtons}
      subtitle={equipmentSubtitle(session) || undefined}
    >
      {/* Left-packed columns: [props A] [props B] [linked projects]. */}
      <div className="alm-session-detail2">
        <div className="alm-session-detail2__col">
          <PropertyTable mode="view" showSource properties={colA} />
        </div>
        <div className="alm-session-detail2__col">
          <PropertyTable mode="view" showSource properties={colB} />
        </div>
        <div className="alm-session-detail2__linked">
          <div className="alm-session-detail2__head">
            {m.sessions_linked_projects_heading()}
          </div>
          {isLinked ? (
            <div className="alm-session-detail2__linked-list">
              {session.linked?.projects?.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="alm-session-detail2__link"
                  onClick={() => onOpenProject?.(p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          ) : (
            <span className="alm-session-detail2__muted">
              {m.common_none()}
            </span>
          )}
        </div>
      </div>

      {/* Calibration linkage (#772): the session's assigned calibration
          masters, or an explicit "no calibration match" state. */}
      <Section title={m.sessions_calib_heading()} defaultOpen>
        <CalibrationLinkage matches={session.calibrationMatches ?? []} />
      </Section>

      {/* Post-hoc notes (#773): debounced-autosave free-text editor.
          key: one instance (draft + debouncer) per session — required by
          SessionNotesSection's contract so a pending save can never be
          flushed against a different session (cross-session lost write). */}
      <Section title={m.sessions_notes_heading()} defaultOpen>
        <SessionNotesSection
          key={session.id}
          sessionId={session.id}
          initialContent={session.notes ?? null}
        />
      </Section>

      {/* Spec 048 T014/T025: on-demand per-frame inventory (present count +
          disk total) with a relink action for frames flagged missing. */}
      <SessionFrameInventory sessionId={session.id} />

      {/* Spec 048 US3 T031: raw sub-frame cleanup review, grouped by this
          session — previously impossible (no per-frame inventory to scan). */}
      <RawFrameCleanupSection sessionId={session.id} defaultOpen={false} />
    </DetailPanel>
  );
}
