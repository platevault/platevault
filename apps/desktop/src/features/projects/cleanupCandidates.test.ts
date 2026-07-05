/**
 * cleanupCandidates helpers — spec 017 WP-E.
 *
 * The reason-string parser must match the backend generator format exactly
 * (cleanup_generator.rs::scan_with_policy) and fall back to null on drift so
 * the UI never fabricates confidence or protection state (constitution II).
 */

import { describe, it, expect } from 'vitest';
import {
  parseCandidateReason,
  isProtectedCandidate,
  groupCandidates,
} from './cleanupCandidates';
import type { CleanupCandidate } from '@/bindings/index';

function candidate(overrides: Partial<CleanupCandidate> = {}): CleanupCandidate {
  return {
    filePath: 'calibrated/light_001.xisf',
    dataType: 'intermediate',
    sizeBytes: 1000,
    reason:
      'intermediate artifact (classified by rule, 90% confidence); protection: normal; policy: archive',
    ...overrides,
  };
}

describe('parseCandidateReason', () => {
  it('parses the documented backend reason format', () => {
    expect(
      parseCandidateReason(
        'master artifact (classified by rule, 95% confidence); protection: protected; policy: delete',
      ),
    ).toEqual({
      classifiedBy: 'rule',
      confidencePct: 95,
      protection: 'protected',
      policy: 'delete',
    });
  });

  it('returns null on format drift instead of fabricating values', () => {
    expect(parseCandidateReason('some future free-form reason')).toBeNull();
    expect(parseCandidateReason('')).toBeNull();
  });
});

describe('isProtectedCandidate', () => {
  it('is true only for a parsed protected level', () => {
    expect(
      isProtectedCandidate(
        candidate({
          reason:
            'final artifact (classified by override, 100% confidence); protection: protected; policy: archive',
        }),
      ),
    ).toBe(true);
    expect(isProtectedCandidate(candidate())).toBe(false);
    expect(isProtectedCandidate(candidate({ reason: 'unparseable' }))).toBe(false);
  });
});

describe('groupCandidates', () => {
  it('groups by data type in intermediate → master → final order with byte subtotals', () => {
    const groups = groupCandidates([
      candidate({ dataType: 'final', sizeBytes: 5000 }),
      candidate({ dataType: 'intermediate', sizeBytes: 1000 }),
      candidate({ dataType: 'master', sizeBytes: 4000 }),
      candidate({ dataType: 'intermediate', sizeBytes: 2000 }),
    ]);
    expect(groups.map((g) => g.dataType)).toEqual(['intermediate', 'master', 'final']);
    expect(groups[0].candidates).toHaveLength(2);
    expect(groups[0].totalBytes).toBe(3000);
    expect(groups[1].totalBytes).toBe(4000);
    expect(groups[2].totalBytes).toBe(5000);
  });

  it('returns an empty list for no candidates', () => {
    expect(groupCandidates([])).toEqual([]);
  });
});
