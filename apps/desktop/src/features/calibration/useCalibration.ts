/**
 * Calibration feature hooks — spec 007.
 *
 * useCalibrationMasters   : loads CalibrationMaster[] from the real backend.
 * useCalibrationSuggest   : calls calibration.match.suggest for one session.
 * useCalibrationAssign    : calls calibration.match.assign; returns loading / result.
 * useCalibrationSettings  : reads prefill_suggestion from persisted settings.
 */

import { useState, useEffect, useCallback } from 'react';
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
  const [state, setState] = useState<UseMastersState>({
    masters: [],
    loading: true,
    error: undefined,
  });

  useEffect(() => {
    let cancelled = false;
    commands
      .calibrationMastersList()
      .then(unwrap)
      .then((masters) => {
        if (!cancelled) setState({ masters, loading: false, error: undefined });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ masters: [], loading: false, error: errMessage(err) });
      });
    return () => { cancelled = true; };
  }, []);

  return state;
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
  const [response, setResponse] = useState<CalibrationMatchSuggestResponse | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [rev, setRev] = useState(0);

  const refresh = useCallback(() => setRev((r) => r + 1), []);

  useEffect(() => {
    if (!sessionId) {
      setResponse(undefined);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    commands
      .calibrationMatchSuggest({
        contractVersion: '2.0.0',
        requestId: `suggest-${sessionId}-${Date.now()}`,
        sessionId,
        calibrationTypes: calibrationTypes ?? null,
      })
      .then(unwrap)
      .then((res) => {
        if (!cancelled) {
          setResponse(res);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errMessage(err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, rev]);

  return { response, loading, error, refresh };
}

// ── Assign ────────────────────────────────────────────────────────────────────

export interface UseAssignState {
  assigning: boolean;
  result: CalibrationMatchAssignResponse | undefined;
  /** Call to persist an assignment. `override` must be true for hard-rule violations. */
  assign: (sessionId: string, masterId: string, override?: boolean) => Promise<CalibrationMatchAssignResponse>;
}

export function useCalibrationAssign(): UseAssignState {
  const [assigning, setAssigning] = useState(false);
  const [result, setResult] = useState<CalibrationMatchAssignResponse | undefined>(undefined);

  const assign = useCallback(
    async (sessionId: string, masterId: string, override = false) => {
      setAssigning(true);
      try {
        const res = unwrap(
          await commands.calibrationMatchAssign({
            contractVersion: '2.0.0',
            requestId: `assign-${sessionId}-${Date.now()}`,
            sessionId,
            masterId,
            override,
          }),
        );
        setResult(res);
        return res;
      } finally {
        setAssigning(false);
      }
    },
    [],
  );

  return { assigning, result, assign };
}

// ── Settings: prefill_suggestion + aging threshold ───────────────────────────

/** Default aging threshold in days — matches SettingsState::default() on Rust side. */
export const DEFAULT_AGING_THRESHOLD_DAYS = 90;

export function useCalibrationSettings(): {
  prefillSuggestion: boolean;
  agingThresholdDays: number;
} {
  const [prefillSuggestion, setPrefillSuggestion] = useState(true);
  const [agingThresholdDays, setAgingThresholdDays] = useState(DEFAULT_AGING_THRESHOLD_DAYS);

  useEffect(() => {
    commands
      .settingsGet('calibration')
      .then(unwrap)
      .then((data) => {
        const v = data.values as Record<string, unknown>;
        if (typeof v['calibrationPrefillSuggestion'] === 'boolean') {
          setPrefillSuggestion(v['calibrationPrefillSuggestion']);
        }
        if (typeof v['calibrationAgingThresholdDays'] === 'number') {
          setAgingThresholdDays(v['calibrationAgingThresholdDays']);
        }
      })
      .catch(() => {
        // Backend unavailable — keep defaults.
      });
  }, []);

  return { prefillSuggestion, agingThresholdDays };
}
