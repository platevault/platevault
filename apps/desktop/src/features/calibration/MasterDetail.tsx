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
 * #642: all three header actions are disabled with an explanatory `title`,
 * not wired to fake IPC — none has a backing flow yet (no project-picker, no
 * replace-master use case, no master file path on the contract for Reveal).
 * Same "disabled, no fake handler" precedent as ArchivePage's Reveal button.
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

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
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
import {
  formatExposureSeconds,
  formatTempC,
  formatGain,
  formatBinning,
} from '@/lib/format';
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

  // Real `usedBySessionIds`/`compatibleSessions` (populated) come from a
  // per-master detail fetch; `sessionsList()` cross-references both sets of
  // ids to human-readable "{target} · {filter} · {night}" labels. Shares the
  // `queryKeys.sessions.all()` cache entry with the rest of the app (e.g.
  // `SessionSourcePicker`) rather than a private key.
  const masterId = master?.id;
  const masterDetailQuery = useQuery({
    queryKey: queryKeys.calibration.master(masterId ?? '__none__'),
    queryFn: async () =>
      unwrap(await commands.calibrationMastersGet(masterId as string)),
    enabled: !!masterId,
  });
  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.all(),
    queryFn: async () => unwrap(await commands.sessionsList()),
  });

  const detail: DetailState = useMemo(() => {
    const empty: DetailState = {
      confirmedNames: [],
      compatibleNames: [],
      loading: false,
      missingFlag: null,
    };
    if (!masterId) return empty;
    if (masterDetailQuery.isFetching || sessionsQuery.isFetching) {
      return { ...empty, loading: true };
    }
    // Mirrors the pre-migration catch-and-swallow: a failed detail or
    // sessions fetch degrades to the empty state rather than an error banner.
    if (
      masterDetailQuery.error ||
      sessionsQuery.error ||
      !masterDetailQuery.data
    ) {
      return empty;
    }
    const masterDetail = masterDetailQuery.data;
    const idToName = new Map<string, string>();
    // Defensive: guard against a non-array `sessionsList()` payload (the old
    // effect's Promise.all().catch() silently swallowed this; a bare `for...of`
    // here would otherwise throw synchronously during render).
    const sessionsList = Array.isArray(sessionsQuery.data)
      ? sessionsQuery.data
      : [];
    for (const s of sessionsList) {
      const k = s.sessionKey;
      idToName.set(s.id, `${k.target} · ${k.filter} · ${k.night}`);
    }
    return {
      confirmedNames: masterDetail.usedBySessionIds
        .map((id) => idToName.get(id) ?? id)
        .filter(Boolean),
      compatibleNames: masterDetail.compatibleSessions
        .map((e) => idToName.get(e.sessionId) ?? e.sessionId)
        .filter(Boolean),
      loading: false,
      missingFlag: masterDetail.missingFlag ?? null,
    };
  }, [
    masterId,
    masterDetailQuery.data,
    masterDetailQuery.isFetching,
    masterDetailQuery.error,
    sessionsQuery.data,
    sessionsQuery.isFetching,
    sessionsQuery.error,
  ]);

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
    {
      key: 'camera',
      label: m.settings_calmatch_camera(),
      value: fp.camera ?? null,
    },
    {
      key: 'gain',
      label: m.settings_calmatch_gain(),
      value: fp.gain != null ? formatGain(fp.gain) : null,
    },
    {
      key: 'exposure',
      label: m.calibration_fp_exposure(),
      // #811: shared formatter (consistent rounding/spacing with Calibration's
      // MastersTable and Inbox), instead of the local `${v}s` ad hoc version.
      value: fp.exposureS != null ? formatExposureSeconds(fp.exposureS) : null,
      applicability: masterFieldApplicability(master.kind, 'exposure'),
    },
    {
      key: 'temp',
      label: m.calibration_fp_temperature(),
      value: fp.tempC != null ? formatTempC(fp.tempC) : null,
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
    {
      key: 'binning',
      label: m.settings_calmatch_binning(),
      // #811: was raw `fp.binning`, unlike MastersTable's binningCell which
      // already normalises the "x" separator to "×" — now consistent.
      value: fp.binning != null ? formatBinning(fp.binning) : null,
    },
    {
      key: 'size',
      label: m.settings_advanced_db_size(),
      value: master.sizeBytes != null ? fmtBytes(master.sizeBytes) : null,
    },
    {
      // #619: the row only shows ageDays conditionally, as a warning pill
      // when the master is aging past the threshold — the actual age is
      // otherwise invisible. The detail panel shows it unconditionally.
      key: 'age',
      label: m.calibration_fp_age(),
      value: m.calibration_fp_age_value({ days: master.ageDays }),
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
      {/* #642: "Use in project" and "Replace master" had no onClick and no
          data path to drive one — there is no project-picker or
          replace-master flow wired anywhere in the app yet. Per the codebase
          convention for not-yet-backed actions (see ArchivePage's disabled
          Reveal), disable with an explanatory title rather than ship a dead
          "live" button. */}
      <Btn
        size="sm"
        variant="primary"
        disabled
        title={m.calibration_action_use_in_project_unavailable_title()}
      >
        {m.calibration_action_use_in_project()}
      </Btn>
      {(isAging1Year || isAgingWarn) && (
        <Btn
          size="sm"
          variant="danger"
          disabled
          title={m.calibration_action_replace_master_unavailable_title()}
        >
          {m.calibration_action_replace_master()}
        </Btn>
      )}
      {/* Platform-native label via the shared revealLabel() helper.
          #642: no master file path is exposed by the backend (no `path`
          field on CalibrationMaster/MasterDetail) — disabled, no fake IPC,
          matching the ArchivePage Reveal precedent. */}
      <Btn
        size="sm"
        disabled
        title={m.calibration_reveal_unavailable_title()}
        data-testid="calibration-reveal-btn"
      >
        {revealLabel()}
      </Btn>
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
