/**
 * T050 — Conflict detection logic for inbox sessions.
 *
 * Flags sessions with mixed properties that suggest the session should be
 * split: mixed gains, mixed filters, exposure times beyond tolerance,
 * temperatures beyond tolerance.
 */

export interface FrameProperties {
  gain: number | null;
  filter: string | null;
  exposureSeconds: number | null;
  temperatureC: number | null;
}

export interface ConflictResult {
  hasConflicts: boolean;
  mixedGains: boolean;
  mixedFilters: boolean;
  exposureOutOfTolerance: boolean;
  temperatureOutOfTolerance: boolean;
  details: string[];
}

const EXPOSURE_TOLERANCE_S = 2;
const TEMPERATURE_TOLERANCE_C = 5;

function uniqueNonNull<T>(values: (T | null)[]): T[] {
  const set = new Set<T>();
  for (const v of values) {
    if (v !== null) set.add(v);
  }
  return [...set];
}

function rangeExceedsTolerance(
  values: (number | null)[],
  tolerance: number,
): boolean {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length < 2) return false;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return max - min > tolerance;
}

export function detectConflicts(frames: FrameProperties[]): ConflictResult {
  if (frames.length < 2) {
    return {
      hasConflicts: false,
      mixedGains: false,
      mixedFilters: false,
      exposureOutOfTolerance: false,
      temperatureOutOfTolerance: false,
      details: [],
    };
  }

  const details: string[] = [];

  const uniqueGains = uniqueNonNull(frames.map((f) => f.gain));
  const mixedGains = uniqueGains.length > 1;
  if (mixedGains) {
    details.push(`Mixed gains: ${uniqueGains.join(', ')}`);
  }

  const uniqueFilters = uniqueNonNull(frames.map((f) => f.filter));
  const mixedFilters = uniqueFilters.length > 1;
  if (mixedFilters) {
    details.push(`Mixed filters: ${uniqueFilters.join(', ')}`);
  }

  const exposures = frames.map((f) => f.exposureSeconds);
  const exposureOutOfTolerance = rangeExceedsTolerance(
    exposures,
    EXPOSURE_TOLERANCE_S,
  );
  if (exposureOutOfTolerance) {
    const valid = exposures.filter((v): v is number => v !== null);
    details.push(
      `Exposure range: ${Math.min(...valid)}s–${Math.max(...valid)}s (tolerance: ${EXPOSURE_TOLERANCE_S}s)`,
    );
  }

  const temps = frames.map((f) => f.temperatureC);
  const temperatureOutOfTolerance = rangeExceedsTolerance(
    temps,
    TEMPERATURE_TOLERANCE_C,
  );
  if (temperatureOutOfTolerance) {
    const valid = temps.filter((v): v is number => v !== null);
    details.push(
      `Temperature range: ${Math.min(...valid)}°C–${Math.max(...valid)}°C (tolerance: ${TEMPERATURE_TOLERANCE_C}°C)`,
    );
  }

  return {
    hasConflicts:
      mixedGains ||
      mixedFilters ||
      exposureOutOfTolerance ||
      temperatureOutOfTolerance,
    mixedGains,
    mixedFilters,
    exposureOutOfTolerance,
    temperatureOutOfTolerance,
    details,
  };
}
