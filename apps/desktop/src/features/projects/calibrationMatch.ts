/**
 * `calibration.match.suggest.batch` IPC helper (spec 037 caller migration).
 *
 * Moves the batch-suggest glue off the hand-written `@/api/commands` wrapper
 * onto the generated `commands.calibrationMatchSuggestBatch` binding
 * (FR-004: the behaviour is moved, not dropped). Supplies the fixed
 * `contractVersion` and defaults `calibrationTypes` to `null` when omitted.
 *
 * Note: `calibration.match.suggest.batch` supports partial success — the
 * *transport*-level Result is unwrapped here (throws on IPC/contract error),
 * but the response's own `status` field ('success' | 'error') carries
 * per-session batch outcomes and is left for the caller to inspect.
 */

import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { CalibrationMatchBatchResponse, CalibrationType } from '@/bindings/index';

export type CalibrationMatchType = CalibrationType;

/**
 * `calibration.match.suggest.batch` — suggest for multiple sessions in one call.
 * Supports partial success.
 */
export async function calibrationMatchSuggestBatch(args: {
  requestId: string;
  sessionIds: string[];
  calibrationTypes?: CalibrationMatchType[];
}): Promise<CalibrationMatchBatchResponse> {
  return unwrap(
    await commands.calibrationMatchSuggestBatch({
      contractVersion: '1.0',
      requestId: args.requestId,
      sessionIds: args.sessionIds,
      calibrationTypes: args.calibrationTypes ?? null,
    }),
  );
}
