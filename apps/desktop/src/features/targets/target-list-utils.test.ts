/**
 * T039b (FR-041): vitest for targets list grouping and sorting logic.
 */
import { describe, it, expect } from 'vitest';
import type { TargetFixture } from '@/data/fixtures/targets';
import { sortTargets, groupTargets } from './target-list-utils';

const FIXTURES: TargetFixture[] = [
  { id: 1, uuid: 'u1', name: 'NGC 7000', common: 'North America Nebula', kind: 'deep sky', sessions: 12, hours: 14.2, projects: 2 },
  { id: 2, uuid: 'u2', name: 'M31', common: 'Andromeda Galaxy', kind: 'deep sky', sessions: 8, hours: 11.8, projects: 1 },
  { id: 3, uuid: 'u3', name: 'Jupiter', common: '', kind: 'planetary', sessions: 6, hours: 2.5, projects: 1 },
  { id: 4, uuid: 'u4', name: 'M42', common: 'Orion Nebula', kind: 'deep sky', sessions: 5, hours: 3.4, projects: 0 },
  { id: 5, uuid: 'u5', name: 'IC 1396', common: "Elephant's Trunk", kind: 'deep sky', sessions: 4, hours: 9.3, projects: 1 },
];

describe('sortTargets', () => {
  it('sorts by name ascending', () => {
    const result = sortTargets(FIXTURES, 'name');
    const names = result.map(t => t.name);
    expect(names).toEqual(['IC 1396', 'Jupiter', 'M31', 'M42', 'NGC 7000']);
  });

  it('sorts by sessions descending', () => {
    const result = sortTargets(FIXTURES, 'sessions');
    expect(result[0].sessions).toBeGreaterThanOrEqual(result[1].sessions ?? 0);
    expect(result[0].name).toBe('NGC 7000'); // 12 sessions
    expect(result[1].name).toBe('M31');       // 8 sessions
  });

  it('sorts by integration hours descending', () => {
    const result = sortTargets(FIXTURES, 'hours');
    expect(result[0].hours).toBeGreaterThanOrEqual(result[1].hours ?? 0);
    expect(result[0].name).toBe('NGC 7000'); // 14.2h
    expect(result[1].name).toBe('M31');       // 11.8h
  });

  it('does not mutate the original array', () => {
    const original = [...FIXTURES];
    sortTargets(FIXTURES, 'sessions');
    expect(FIXTURES.map(t => t.id)).toEqual(original.map(t => t.id));
  });
});

describe('groupTargets — groupBy none', () => {
  it('returns a single group with all targets', () => {
    const groups = groupTargets(FIXTURES, 'none', 'name');
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('');
    expect(groups[0].targets).toHaveLength(FIXTURES.length);
  });

  it('group targets are sorted by the specified sortBy', () => {
    const groups = groupTargets(FIXTURES, 'none', 'sessions');
    expect(groups[0].targets[0].name).toBe('NGC 7000');
  });
});

describe('groupTargets — groupBy type', () => {
  it('creates one group per unique kind', () => {
    const groups = groupTargets(FIXTURES, 'type', 'name');
    const keys = groups.map(g => g.key).sort();
    expect(keys).toContain('deep sky');
    expect(keys).toContain('planetary');
  });

  it('deep sky group contains 4 items', () => {
    const groups = groupTargets(FIXTURES, 'type', 'name');
    const ds = groups.find(g => g.key === 'deep sky');
    expect(ds?.targets).toHaveLength(4);
  });

  it('planetary group contains 1 item (Jupiter)', () => {
    const groups = groupTargets(FIXTURES, 'type', 'name');
    const pl = groups.find(g => g.key === 'planetary');
    expect(pl?.targets).toHaveLength(1);
    expect(pl?.targets[0].name).toBe('Jupiter');
  });

  it('groups are sorted alphabetically by key', () => {
    const groups = groupTargets(FIXTURES, 'type', 'name');
    const keys = groups.map(g => g.key);
    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
  });

  it('within each group targets are sorted by sortBy', () => {
    const groups = groupTargets(FIXTURES, 'type', 'sessions');
    const ds = groups.find(g => g.key === 'deep sky');
    // NGC 7000 has most sessions (12)
    expect(ds?.targets[0].name).toBe('NGC 7000');
  });

  it('labels capitalize the key', () => {
    const groups = groupTargets(FIXTURES, 'type', 'name');
    for (const g of groups) {
      if (g.key) {
        expect(g.label[0]).toBe(g.label[0].toUpperCase());
      }
    }
  });
});

describe('groupTargets — groupBy constellation', () => {
  it('targets without common name go into Other group', () => {
    const groups = groupTargets(FIXTURES, 'constellation', 'name');
    const other = groups.find(g => g.key === 'Other');
    expect(other).toBeDefined();
    // Jupiter has no common name
    expect(other?.targets.some(t => t.name === 'Jupiter')).toBe(true);
  });

  it('targets with common name are grouped by first word of common name', () => {
    const groups = groupTargets(FIXTURES, 'constellation', 'name');
    // 'Andromeda Galaxy' → key 'Andromeda'
    const andromeda = groups.find(g => g.key === 'Andromeda');
    expect(andromeda?.targets.some(t => t.name === 'M31')).toBe(true);
  });
});
