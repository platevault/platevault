/**
 * Vitest unit tests for artifact helpers (spec 012 T023/T027/T028).
 *
 * Tests pure grouping logic and mock-invoke-based integration.
 * Does NOT test real filesystem watchers (deferred — needs GUI).
 */

import { describe, it, expect } from 'vitest';
import { groupArtifactsByLaunch } from './artifacts';
import type { ArtifactSummary } from '@/api/commands';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeArtifact(overrides: Partial<ArtifactSummary> & { id: string }): ArtifactSummary {
  return {
    projectId: 'proj-1',
    path: `output/${overrides.id}.xisf`,
    kind: 'intermediate',
    tool: 'pixinsight',
    detectedAt: '2026-06-01T10:00:00Z',
    lastSeenAt: '2026-06-01T10:00:00Z',
    state: 'present',
    classificationConfidence: 0.9,
    classificationSource: 'rule',
    sizeBytes: 1024,
    toolLaunchId: null,
    ...overrides,
  };
}

// ── groupArtifactsByLaunch ─────────────────────────────────────────────────────

describe('groupArtifactsByLaunch', () => {
  it('groups attributed artifacts under their launch id', () => {
    const arts = [
      makeArtifact({ id: 'a1', toolLaunchId: 'launch-1' }),
      makeArtifact({ id: 'a2', toolLaunchId: 'launch-1' }),
      makeArtifact({ id: 'a3', toolLaunchId: 'launch-2' }),
    ];

    const groups = groupArtifactsByLaunch(arts);

    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.toolLaunchId === 'launch-1')?.artifacts).toHaveLength(2);
    expect(groups.find((g) => g.toolLaunchId === 'launch-2')?.artifacts).toHaveLength(1);
  });

  it('places unattributed artifacts in a null bucket at end', () => {
    const arts = [
      makeArtifact({ id: 'a1', toolLaunchId: 'launch-1' }),
      makeArtifact({ id: 'a2', toolLaunchId: null }),
    ];

    const groups = groupArtifactsByLaunch(arts);

    expect(groups).toHaveLength(2);
    expect(groups[groups.length - 1].toolLaunchId).toBeNull();
    expect(groups[groups.length - 1].artifacts).toHaveLength(1);
    expect(groups[groups.length - 1].artifacts[0].id).toBe('a2');
  });

  it('all unattributed artifacts go to a single null bucket (T028)', () => {
    const arts = [
      makeArtifact({ id: 'a1', toolLaunchId: null }),
      makeArtifact({ id: 'a2', toolLaunchId: null }),
    ];

    const groups = groupArtifactsByLaunch(arts);

    expect(groups).toHaveLength(1);
    expect(groups[0].toolLaunchId).toBeNull();
    expect(groups[0].artifacts).toHaveLength(2);
  });

  it('sorts artifacts within a group by detectedAt ascending', () => {
    const arts = [
      makeArtifact({ id: 'later', toolLaunchId: 'l1', detectedAt: '2026-06-01T12:00:00Z' }),
      makeArtifact({ id: 'earlier', toolLaunchId: 'l1', detectedAt: '2026-06-01T10:00:00Z' }),
    ];

    const groups = groupArtifactsByLaunch(arts);
    const ids = groups[0].artifacts.map((a) => a.id);
    expect(ids).toEqual(['earlier', 'later']);
  });

  it('uses launchOrder to sort attributed buckets', () => {
    const arts = [
      makeArtifact({ id: 'a1', toolLaunchId: 'old-launch' }),
      makeArtifact({ id: 'a2', toolLaunchId: 'new-launch' }),
    ];

    // launchOrder lists newest first
    const groups = groupArtifactsByLaunch(arts, ['new-launch', 'old-launch']);

    expect(groups[0].toolLaunchId).toBe('new-launch');
    expect(groups[1].toolLaunchId).toBe('old-launch');
  });

  it('returns empty array for empty artifact list', () => {
    expect(groupArtifactsByLaunch([])).toEqual([]);
  });

  it('single attributed group with no unattributed (T027)', () => {
    const arts = [
      makeArtifact({ id: 'a1', toolLaunchId: 'l1' }),
      makeArtifact({ id: 'a2', toolLaunchId: 'l1' }),
    ];

    const groups = groupArtifactsByLaunch(arts);

    expect(groups).toHaveLength(1);
    expect(groups[0].toolLaunchId).toBe('l1');
    // No null bucket
    expect(groups.every((g) => g.toolLaunchId !== null)).toBe(true);
  });

  it('handles mixed present and missing artifacts', () => {
    const arts = [
      makeArtifact({ id: 'a1', toolLaunchId: 'l1', state: 'present' }),
      makeArtifact({ id: 'a2', toolLaunchId: 'l1', state: 'missing' }),
    ];

    const groups = groupArtifactsByLaunch(arts);
    expect(groups[0].artifacts).toHaveLength(2);
    const missingArt = groups[0].artifacts.find((a) => a.id === 'a2');
    expect(missingArt?.state).toBe('missing');
  });

  it('kind count distribution is correct for count badges', () => {
    const arts = [
      makeArtifact({ id: 'a1', toolLaunchId: 'l1', kind: 'master' }),
      makeArtifact({ id: 'a2', toolLaunchId: 'l1', kind: 'intermediate' }),
      makeArtifact({ id: 'a3', toolLaunchId: 'l1', kind: 'final' }),
    ];

    const groups = groupArtifactsByLaunch(arts);
    const kinds = groups[0].artifacts.map((a) => a.kind).sort();
    expect(kinds).toEqual(['final', 'intermediate', 'master']);
  });
});
