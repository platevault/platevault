// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * #599 (Constitution-II): this step used to render `MOCK_FLAT_ROWS` /
 * `SHARED_ROWS` — a static fixture unrelated to the project actually being
 * created. It now calls the same `calibration.match.suggest.batch` matcher
 * `CalibrationMatchPanel` uses on the project detail page, grouping flat
 * candidates by the light sessions' real filter and building shared
 * dark/bias/dark-flat options from the real candidate union across the
 * selected sessions.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { m } from '@/lib/i18n';
import { Pill, Box, Section, EmptyState } from '@/ui';
import { queryKeys } from '@/data/queryKeys';
import { calibrationMatchSuggestBatch } from '@/features/projects/calibrationMatch';
import type { BatchSessionResultDto } from '@/bindings/index';

export interface CalibrationMapping {
  flatMappings: Record<string, string>; // filter -> master_id
  sharedDarkId: string;
  sharedBiasId: string;
  sharedDarkFlatId: string;
}

export interface StepCalibrationProps {
  selectedSessionIds: string[];
  data: CalibrationMapping;
  onChange: (data: CalibrationMapping) => void;
}

interface CandidateOption {
  id: string;
  confidence: number | null;
}

interface FlatRow {
  key: string;
  filterLabel: string;
  lightsCovered: string;
  options: CandidateOption[];
}

// `status` values match `calibration.match.suggest.batch`'s per-result status.
function statusLabel(status: string): string {
  switch (status) {
    case 'match':
      return m.projects_calib_status_match();
    case 'ambiguous':
      return m.projects_calib_status_ambiguous();
    case 'no_match':
      return m.projects_calib_status_no_match();
    case 'observer_location_missing':
      return m.projects_calib_status_needs_location();
    case 'session.mixed_state':
      return m.projects_calib_status_mixed_session();
    default:
      return status;
  }
}

function candidateLabel(option: CandidateOption): string {
  const short = `${option.id.slice(0, 8)}…`;
  return option.confidence != null
    ? `${short} (${Math.round(option.confidence * 100)}%)`
    : short;
}

function mergeCandidate(
  map: Map<string, number | null>,
  masterId: string,
  confidence: number | null,
): void {
  const existing = map.get(masterId);
  if (existing === undefined || (confidence ?? -1) > (existing ?? -1)) {
    map.set(masterId, confidence);
  }
}

function sortedOptions(map: Map<string, number | null>): CandidateOption[] {
  return [...map.entries()]
    .sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1))
    .map(([id, confidence]) => ({ id, confidence }));
}

// ── Component ───────────────────────────────────────────────────────────────

export function StepCalibration({
  selectedSessionIds,
  data,
  onChange,
}: StepCalibrationProps) {
  const { data: batch, isFetching: loading } = useQuery({
    queryKey: queryKeys.calibration.matches(selectedSessionIds.join(',')),
    queryFn: () =>
      calibrationMatchSuggestBatch({
        requestId: `wizard-calib-${Date.now()}`,
        sessionIds: selectedSessionIds,
        calibrationTypes: ['dark', 'flat', 'bias'],
      }),
    enabled: selectedSessionIds.length > 0,
  });

  const results = useMemo<BatchSessionResultDto[]>(
    () => (batch && batch.status !== 'error' ? (batch.results ?? []) : []),
    [batch],
  );

  const flatRows = useMemo<FlatRow[]>(() => {
    const byKey = new Map<
      string,
      {
        filterLabel: string;
        sessions: number;
        frames: number;
        targets: Set<string>;
        options: Map<string, number | null>;
        status: string;
      }
    >();
    for (const r of results) {
      if (r.calibrationType !== 'flat') continue;
      const first = r.candidates?.[0];
      const key = first?.filter ?? r.sessionId;
      const entry = byKey.get(key) ?? {
        filterLabel: first?.filter ?? m.projects_wizard_filter_unresolved(),
        sessions: 0,
        frames: 0,
        targets: new Set<string>(),
        options: new Map<string, number | null>(),
        status: r.status,
      };
      entry.sessions += 1;
      if (first?.frameCount) entry.frames += first.frameCount;
      if (first?.targetName) entry.targets.add(first.targetName);
      for (const c of r.candidates ?? []) {
        mergeCandidate(entry.options, c.masterId, c.confidence);
      }
      byKey.set(key, entry);
    }
    return [...byKey.entries()].map(([key, e]) => ({
      key,
      filterLabel: e.filterLabel,
      lightsCovered: `${[...e.targets].join(', ') || m.projects_wizard_target_unresolved()} · ${e.sessions} sess (${e.frames} frames) · ${statusLabel(e.status)}`,
      options: sortedOptions(e.options),
    }));
  }, [results]);

  const sharedOptions = useMemo(() => {
    const build = (type: 'dark' | 'bias'): CandidateOption[] => {
      const map = new Map<string, number | null>();
      for (const r of results) {
        if (r.calibrationType !== type) continue;
        for (const c of r.candidates ?? []) {
          mergeCandidate(map, c.masterId, c.confidence);
        }
      }
      return sortedOptions(map);
    };
    return { dark: build('dark'), bias: build('bias') };
  }, [results]);

  const sharedRows: Array<{
    role: string;
    field: 'sharedDarkId' | 'sharedBiasId' | 'sharedDarkFlatId';
    options: CandidateOption[];
  }> = [
    {
      role: m.common_dark(),
      field: 'sharedDarkId',
      options: sharedOptions.dark,
    },
    {
      role: m.common_bias(),
      field: 'sharedBiasId',
      options: sharedOptions.bias,
    },
    // No calibration_type 'dark_flat' exists in the matcher yet — WBPP can
    // compute dark flats from bias + darks, so this stays a manual skip-only
    // choice rather than a fabricated candidate list.
    {
      role: m.projects_wizard_col_role_dark_flat(),
      field: 'sharedDarkFlatId',
      options: [],
    },
  ];

  if (selectedSessionIds.length === 0) {
    return (
      <div className="alm-wizard-calib__root">
        <EmptyState
          title={m.projects_wizard_calib_no_sources_title()}
          desc={m.projects_wizard_calib_no_sources_desc()}
        />
      </div>
    );
  }

  return (
    <div className="alm-wizard-calib__root">
      {/* Step description */}
      <div className="alm-wizard-calib__desc">
        {m.projects_wizard_calib_desc()}
      </div>

      {loading ? (
        <div className="alm-wizard-calib__loading">
          {m.projects_calib_checking()}
        </div>
      ) : (
        <>
          {/* ── Flats per light source (by filter) ── */}
          <Section title={m.projects_wizard_flats_title()}>
            <div className="alm-wizard-calib__flat-subtitle">
              {m.projects_wizard_flats_subtitle()}
            </div>
            {flatRows.length === 0 ? (
              <EmptyState title={m.projects_calib_no_data_title()} />
            ) : (
              <table className="alm-simple-table">
                <thead>
                  <tr>
                    <th>{m.common_filter()}</th>
                    <th>{m.projects_wizard_col_lights()}</th>
                    <th>{m.projects_wizard_col_master_flat()}</th>
                  </tr>
                </thead>
                <tbody>
                  {flatRows.map((row) => {
                    const currentValue =
                      data.flatMappings[row.filterLabel] ??
                      row.options[0]?.id ??
                      '';
                    return (
                      <tr key={row.key}>
                        <td>
                          <Pill variant="ghost">{row.filterLabel}</Pill>
                        </td>
                        <td className="alm-wizard-calib__cell-lights">
                          {row.lightsCovered}
                        </td>
                        <td>
                          <select
                            value={currentValue}
                            onChange={(e) =>
                              onChange({
                                ...data,
                                flatMappings: {
                                  ...data.flatMappings,
                                  [row.filterLabel]: e.target.value,
                                },
                              })
                            }
                            className="alm-wizard-calib__select"
                            aria-label={m.projects_wizard_flat_master_for_aria({
                              filter: row.filterLabel,
                            })}
                          >
                            <option value="">
                              {m.projects_wizard_calib_skip_option()}
                            </option>
                            {row.options.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {candidateLabel(opt)}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>

          {/* ── Shared calibration: darks, bias, dark flats ── */}
          <Section title={m.projects_wizard_shared_calib_title()}>
            <table className="alm-simple-table">
              <thead>
                <tr>
                  <th className="alm-wizard-calib__col-role">
                    {m.projects_wizard_col_role()}
                  </th>
                  <th>{m.projects_wizard_col_pick()}</th>
                </tr>
              </thead>
              <tbody>
                {sharedRows.map((row) => {
                  const currentValue = data[row.field] || '';
                  return (
                    <tr key={row.field}>
                      <td>
                        <Pill variant="ghost">{row.role}</Pill>
                      </td>
                      <td>
                        <select
                          value={currentValue}
                          onChange={(e) =>
                            onChange({ ...data, [row.field]: e.target.value })
                          }
                          className="alm-wizard-calib__select"
                          aria-label={m.projects_wizard_pick_role_aria({
                            role: row.role,
                          })}
                        >
                          <option value="">
                            {m.projects_wizard_calib_skip_option()}
                          </option>
                          {row.options.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {candidateLabel(opt)}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Section>
        </>
      )}

      <Box title={m.projects_wizard_why_title()}>
        <p>{m.projects_wizard_why_desc()}</p>
      </Box>
    </div>
  );
}
