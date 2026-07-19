// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Calibration feature hooks — spec 007, TanStack Query (#610).
 *
 * useCalibrationMasters   : loads CalibrationMaster[] from the real backend.
 * useCalibrationSuggest   : calls calibration.match.suggest for one session.
 * useCalibrationAssign    : calls calibration.match.assign; returns loading / result.
 * useCalibrationSettings  : reads prefill_suggestion from persisted settings.
 */

import { useQuery, useMutation } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type {
  CalibrationMatchSuggestResponse,
  CalibrationMatchAssignResponse,
  CalibrationType,
} from '@/bindings/index';
import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';
import { errMessage } from '@/lib/errors';

// ── Masters list ─────────────────────────────────────────────────────────────

export interface UseMastersState {
  masters: CalibrationMaster[];
  loading: boolean;
  error: string | undefined;
}

export function useCalibrationMasters(): UseMastersState {
  const { data, isFetching, error } = useQuery({
    queryKey: queryKeys.calibration.masters(),
    queryFn: async () => unwrap(await commands.calibrationMastersList()),
  });
  return {
    masters: data ?? [],
    loading: isFetching,
    error: error ? errMessage(error) : undefined,
  };
}

// ── Suggest for one session ───────────────────────────────────────────────────

export interface UseSuggestState {
  response: CalibrationMatchSuggestResponse | undefined;
  loading: boolean;
  error: string | undefined;
  /** Re-run the suggest call (e.g. after an assign). */
  refresh: () => void;
}

export function useCalibrationSuggest(
  sessionId: string | undefined,
  calibrationTypes?: CalibrationType[],
): UseSuggestState {
  const queryKey = queryKeys.calibration.matches(sessionId ?? '__none__');
  const { data, isFetching, error, refetch } = useQuery({
    queryKey,
    queryFn: async () =>
      unwrap(
        await commands.calibrationMatchSuggest({
          contractVersion: '2.0.0',
          requestId: `suggest-${sessionId}-${Date.now()}`,
          sessionId: sessionId as string,
          calibrationTypes: calibrationTypes ?? null,
        }),
      ),
    enabled: !!sessionId,
  });
  return {
    response: data,
    loading: isFetching,
    error: error ? errMessage(error) : undefined,
    refresh: () => void refetch(),
  };
}

// ── Assign ────────────────────────────────────────────────────────────────────

export interface UseAssignState {
  assigning: boolean;
  result: CalibrationMatchAssignResponse | undefined;
  /** Call to persist an assignment. `override` must be true for hard-rule violations. */
  assign: (
    sessionId: string,
    masterId: string,
    override?: boolean,
  ) => Promise<CalibrationMatchAssignResponse>;
}

export function useCalibrationAssign(): UseAssignState {
  const mutation = useMutation({
    mutationFn: async ({
      sessionId,
      masterId,
      override,
    }: {
      sessionId: string;
      masterId: string;
      override: boolean;
    }) =>
      unwrap(
        await commands.calibrationMatchAssign({
          contractVersion: '2.0.0',
          requestId: `assign-${sessionId}-${Date.now()}`,
          sessionId,
          masterId,
          override,
        }),
      ),
  });

  const assign = async (
    sessionId: string,
    masterId: string,
    override = false,
  ) => mutation.mutateAsync({ sessionId, masterId, override });

  return {
    assigning: mutation.isPending,
    result: mutation.data,
    assign,
  };
}

// ── Settings: prefill_suggestion + aging threshold ───────────────────────────

/** Default aging threshold in days — matches SettingsState::default() on Rust side. */
export const DEFAULT_AGING_THRESHOLD_DAYS = 90;

export function useCalibrationSettings(): {
  prefillSuggestion: boolean;
  agingThresholdDays: number;
} {
  const { data } = useQuery({
    queryKey: queryKeys.calibration.settings(),
    queryFn: async () => {
      const res = unwrap(await commands.settingsGet('calibration'));
      const v = res.values as Record<string, unknown>;
      return {
        prefillSuggestion:
          typeof v['calibrationPrefillSuggestion'] === 'boolean'
            ? v['calibrationPrefillSuggestion']
            : true,
        agingThresholdDays:
          typeof v['calibrationAgingThresholdDays'] === 'number'
            ? v['calibrationAgingThresholdDays']
            : DEFAULT_AGING_THRESHOLD_DAYS,
      };
    },
  });

  return {
    prefillSuggestion: data?.prefillSuggestion ?? true,
    agingThresholdDays:
      data?.agingThresholdDays ?? DEFAULT_AGING_THRESHOLD_DAYS,
  };
}
