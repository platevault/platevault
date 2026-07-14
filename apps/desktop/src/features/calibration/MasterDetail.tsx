// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * MasterDetail — spec 007 wired · spec 043 §4 (calibration detail redesign).
 *
 * Left-packed flat tabular layout matching SessionDetail exactly:
 *   [props A] [props B] [sessions column: "Used by" + "Compatible" stacked]
 *
 * Actions (Use in project / Replace master / Reveal) are inline-left
 * in the title via titleExtra, wrapped in alm-session-detail2__actions — same
 * pattern as SessionDetail's actionButtons. No `actions` prop passed to
 * DetailPanel. No subtitle (kind is already in the title, size is redundant).
 *
 * Data wiring:
 *   - master.usedBySessionIds from the list endpoint is always empty.
 *   - We fetch getCalibrationMaster(master.id) → MasterDetail_Serialize whose
 *     usedBySessionIds and compatibleSessions are populated, then cross-reference
 *     listSessions() to build "{target} · {filter} · {night}" labels for both.
 *
 * Matching hero (spec 043 §4 "Detail hero = compatible-sessions match table"):
 *   `MatchCandidatesPanel` is mounted below the fingerprint/linked-sessions row
 *   using the master's first `usedBySessionIds` entry as the matching context
 *   — `calibration.match.suggest` is anchored on a light SESSION (it returns
 *   ranked candidate masters for that one session), so a session id is
 *   required to drive it. `compatibleSessions` cannot supply that id: the
 *   backend leaves it an empty stub today (`masters_get` in
 *   crates/app/calibration/src/matching.rs hardcodes `compatible_sessions:
 *   vec![]`), so it is not used here. When the master has no used session yet
 *   the panel shows its existing "no selection" empty state — real once the
 *   master gets its first assignment instead of faked from stub data.
 */

import { useEffect, useState } from 'react';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';
import {
  DetailPane,
  DetailPanel,
  type PropertyDef,
  PropertyTable,
} from '@/components';
import { Btn, EmptyState, Pill } from '@/ui';
import type { CalibrationMatchMissingFlag } from '@/bindings/index';
import { m } from '@/lib/i18n';
import { revealLabel } from '@/lib/reveal-label';
import { SessionListPopover } from './SessionListPopover';
import { MatchCandidatesPanel } from './MatchCandidatesPanel';
import { useCalibrationAssign, useCalibrationSuggest } from './useCalibration';
import { masterFieldApplicability } from './master-applicability';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  master: CalibrationMaster | null;
  prefillSuggestion: boolean;
  /** Days threshold for aging warnings. Comes from persisted settings (FR-023). */
  agingThresholdDays: number;
}

// ── Detail state (confirmed + compatible sessions resolved to names) ──────────

interface DetailState {
  confirmedNames: string[];
  compatibleNames: string[];
  loading: boolean;
  /** spec 048 US5 (FR-024/025): derived "missing" flag from `calibrationMastersGet`. */
  missingFlag: CalibrationMatchMissingFlag | null;
}

// spec 048 US5: distinct wording per trigger path (task requirement — the two
// paths point the user at different problems, so they must read differently).
function missingFlagLabel(flag: CalibrationMatchMissingFlag): string {
  switch (flag) {
    case 'master_missing':
      return m.calibration_flag_master_missing();
    case 'source_subs_missing':
      return m.calibration_flag_source_subs_missing();
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MasterDetail({
  master,
  prefillSuggestion,
  agingThresholdDays,
}: Props) {
  const [detail, setDetail] = useState<DetailState>({
    confirmedNames: [],
    compatibleNames: [],
    loading: false,
    missingFlag: null,
  });

  // Matching context: the session `calibration.match.suggest` is anchored on.
  // See the file-header note — real `usedBySessionIds`, not the stub
  // `compatibleSessions` field.
  const matchSessionId = master?.usedBySessionIds[0];
  const {
    response: suggestResponse,
    loading: suggestLoading,
    error: suggestError,
    refresh: refreshSuggest,
  } = useCalibrationSuggest(matchSessionId);
  const { assigning, assign } = useCalibrationAssign();

  const handleAssign = async (masterId: string, override: boolean) => {
    if (!matchSessionId) {
      return {
        status: 'error',
        error: {
          code: 'no_session',
          message: m.calibration_compatible_sessions_no_anchor_desc(),
        },
      };
    }
    const res = await assign(matchSessionId, masterId, override);
    if (res.status === 'success') refreshSuggest();
    // Normalize: the real response types `error`/`details` as `| null`, while
    // the panel's prop type only allows the object or `undefined`.
    return {
      status: res.status,
      error: res.error
        ? {
            code: res.error.code,
            message: res.error.message,
            details: res.error.details ?? undefined,
          }
        : undefined,
    };
  };

  useEffect(() => {
    if (!master) {
      setDetail({
        confirmedNames: [],
        compatibleNames: [],
        loading: false,
        missingFlag: null,
      });
      return;
    }
    const masterId = master.id;
    let cancelled = false;
    setDetail({
      confirmedNames: [],
      compatibleNames: [],
      loading: true,
      missingFlag: null,
    });

    Promise.all([
      commands.calibrationMastersGet(masterId).then(unwrap),
      commands.sessionsList().then(unwrap),
    ])
      .then(([masterDetail, sessions]) => {
        if (cancelled) return;
        const idToName = new Map<string, string>();
        for (const s of sessions) {
          const k = s.sessionKey;
          idToName.set(s.id, `${k.target} · ${k.filter} · ${k.night}`);
        }
        const confirmedNames = masterDetail.usedBySessionIds
          .map((id) => idToName.get(id) ?? id)
          .filter(Boolean);
        const compatibleNames = masterDetail.compatibleSessions
          .map((e) => idToName.get(e.sessionId) ?? e.sessionId)
          .filter(Boolean);
        setDetail({
          confirmedNames,
          compatibleNames,
          loading: false,
          missingFlag: masterDetail.missingFlag ?? null,
        });
      })
      .catch(() => {
        if (!cancelled)
          setDetail({
            confirmedNames: [],
            compatibleNames: [],
            loading: false,
            missingFlag: null,
          });
      });

    return () => {
      cancelled = true;
    };
  }, [master]);

  if (!master) {
    return (
      <DetailPane>
        <EmptyState
          title={m.calibration_select_master_title()}
          desc={m.calibration_select_master_desc()}
        />
      </DetailPane>
    );
  }

  const isAging1Year = master.ageDays >= 365;
  const isAgingWarn = master.ageDays > agingThresholdDays && !isAging1Year;
  const kindStr = master.kind.toString().toLowerCase().replace('_', ' ');
  const fp = master.fingerprint;

  const kindCap = kindStr.charAt(0).toUpperCase() + kindStr.slice(1);
  const masterDisc =
    kindStr === 'dark'
      ? fp.exposureS != null
        ? `${fp.exposureS}s`
        : ''
      : kindStr === 'flat'
        ? (fp.filter ?? '')
        : '';
  const masterTitle = masterDisc
    ? m.calibration_master_title_disc({ kind: kindCap, disc: masterDisc })
    : m.calibration_master_title({ kind: kindCap });

  // Fingerprint as flat PropertyTable rows — split across two columns like
  // SessionDetail's factProps. Rows are always present (never omitted for a
  // missing value — that collapsed "missing" into "not-applicable", spec-030
  // Q16 / FR-135); applicability per master kind comes from
  // `masterFieldApplicability` (data-model.md matrix), so an applicable-but-
  // absent field renders the unresolved chip instead of silently vanishing.
  const fingerprintProps: PropertyDef[] = [
    { key: 'kind', label: m.calibration_fp_kind(), value: kindStr },
    { key: 'camera', label: m.settings_calmatch_camera(), value: fp.camera ?? null },
    { key: 'gain', label: m.settings_calmatch_gain(), value: fp.gain ?? null },
    {
      key: 'exposure',
      label: m.calibration_fp_exposure(),
      value: fp.exposureS != null ? `${fp.exposureS}s` : null,
      applicability: masterFieldApplicability(master.kind, 'exposure'),
    },
    {
      key: 'temp',
      label: m.calibration_fp_temperature(),
      value: fp.tempC != null ? `${fp.tempC}°C` : null,
      applicability: masterFieldApplicability(master.kind, 'setTemp'),
    },
    {
      key: 'filter',
      label: m.common_filter(),
      value: fp.filter ?? null,
      applicability: masterFieldApplicability(master.kind, 'filter'),
    },
    {
      key: 'sensorMode',
      label: m.calibration_fp_sensor_mode(),
      value: fp.sensorMode ?? null,
    },
    { key: 'binning', label: m.settings_calmatch_binning(), value: fp.binning ?? null },
    {
      key: 'size',
      label: m.settings_advanced_db_size(),
      value: master.sizeBytes != null ? fmtBytes(master.sizeBytes) : null,
    },
  ];

  const mid = Math.ceil(fingerprintProps.length / 2);
  const colA = fingerprintProps.slice(0, mid);
  const colB = fingerprintProps.slice(mid);

  // Actions inline-left in the title, same pattern as SessionDetail's actionButtons.
  const actionButtons = (
    <span className="alm-session-detail2__actions">
      {/* spec 048 US5 (FR-024/025): distinct wording per trigger path; the
			    match itself is never auto-invalidated or removed, so this is a
			    warning badge, not a blocking state. */}
      {detail.missingFlag && (
        <Pill variant="danger" data-testid="calibration-missing-flag">
          {missingFlagLabel(detail.missingFlag)}
        </Pill>
      )}
      <Btn size="sm" variant="primary">
        {m.calibration_action_use_in_project()}
      </Btn>
      {(isAging1Year || isAgingWarn) && (
        <Btn size="sm" variant="danger">
          {m.calibration_action_replace_master()}
        </Btn>
      )}
      {/* Platform-native label via the shared revealLabel() helper. */}
      <Btn size="sm">{revealLabel()}</Btn>
    </span>
  );

  return (
    <DetailPanel
      variant="calibration"
      title={<strong>{masterTitle}</strong>}
      titleExtra={actionButtons}
    >
      {/* Left-packed columns: [props A] [props B] [sessions: Used by + Compatible stacked]. */}
      <div className="alm-session-detail2">
        <div className="alm-session-detail2__col">
          <PropertyTable mode="view" properties={colA} />
        </div>
        <div className="alm-session-detail2__col">
          <PropertyTable mode="view" properties={colB} />
        </div>

        {/* Single column with both session popovers stacked vertically. */}
        <div className="alm-session-detail2__linked alm-session-detail2__linked--stack">
          <SessionListPopover
            label={m.calibration_used_by_label()}
            names={detail.loading ? [] : detail.confirmedNames}
          />
          <SessionListPopover
            label={m.calibration_compatible_label()}
            names={detail.loading ? [] : detail.compatibleNames}
          />
        </div>
      </div>

      {/* Detail hero (spec 043 §4): ranked candidate-masters match table for
			    the master's matching-context session, with assign/cancel. */}
      <div className="alm-session-detail2__match">
        <MatchCandidatesPanel
          sessionId={matchSessionId ?? ''}
          response={suggestResponse}
          loading={suggestLoading}
          error={suggestError}
          onAssign={handleAssign}
          assigning={assigning}
          prefillSuggestion={prefillSuggestion}
        />
      </div>
    </DetailPanel>
  );
}
