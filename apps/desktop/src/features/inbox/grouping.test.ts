/**
 * Unit tests for the multi-level grouping engine (spec 041, US2 / FR-009).
 *
 * Covers:
 * 1. Empty dimensions → single 'All' leaf with all items.
 * 2. Single-dimension grouping with correct counts.
 * 3. Two-level nesting (target → frameType) produces correct child structure.
 * 4. Items missing a dimension land in a NONE_KEY group sorted LAST.
 * 5. Groups sorted by label, numeric-aware.
 * 6. flattenLeafItems returns leaves depth-first.
 * 7. Unknown dimension (no accessor) is skipped.
 */

import { describe, it, expect } from 'vitest';
import { groupByDimensions, flattenLeafItems, NONE_KEY } from './grouping';

// ── Fixture type ──────────────────────────────────────────────────────────────

interface Item {
  id: string;
  target: string | null;
  frameType: string | null;
}

const accessors = {
  target: (item: Item) => item.target,
  frameType: (item: Item) => item.frameType,
};

// ── Test data ─────────────────────────────────────────────────────────────────

const makeItem = (id: string, target: string | null, frameType: string | null): Item =>
  ({ id, target, frameType });

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('groupByDimensions', () => {
  it('(1) empty dimensions returns a single All leaf containing all items', () => {
    const items = [
      makeItem('a', 'NGC 1234', 'light'),
      makeItem('b', 'NGC 1234', 'dark'),
      makeItem('c', 'M31', 'light'),
    ];
    const result = groupByDimensions(items, [], accessors);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('All');
    expect(result[0].key).toBe('__all__');
    expect(result[0].count).toBe(3);
    expect(result[0].items).toHaveLength(3);
    expect(result[0].children).toHaveLength(0);
  });

  it('(1) empty dimensions with empty item list returns one All leaf with count 0', () => {
    const result = groupByDimensions([], [], accessors);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(0);
    expect(result[0].items).toHaveLength(0);
  });

  it('(2) single-dimension grouping produces correct group counts', () => {
    const items = [
      makeItem('a', 'M31', 'light'),
      makeItem('b', 'M31', 'dark'),
      makeItem('c', 'NGC 1234', 'light'),
    ];
    const result = groupByDimensions(items, ['target'], accessors);

    expect(result).toHaveLength(2);

    const m31 = result.find((n) => n.label === 'M31');
    const ngc  = result.find((n) => n.label === 'NGC 1234');

    expect(m31).toBeDefined();
    expect(m31!.count).toBe(2);
    expect(m31!.items).toHaveLength(2);
    expect(m31!.children).toHaveLength(0);

    expect(ngc).toBeDefined();
    expect(ngc!.count).toBe(1);
    expect(ngc!.items).toHaveLength(1);
  });

  it('(3) two-level nesting produces correct child structure', () => {
    const items = [
      makeItem('a', 'M31', 'light'),
      makeItem('b', 'M31', 'light'),
      makeItem('c', 'M31', 'dark'),
      makeItem('d', 'NGC 1234', 'flat'),
    ];
    const result = groupByDimensions(items, ['target', 'frameType'], accessors);

    // Top level: M31 and NGC 1234.
    expect(result).toHaveLength(2);

    const m31 = result.find((n) => n.label === 'M31')!;
    expect(m31.count).toBe(3);
    expect(m31.items).toHaveLength(0);    // inner node — no items
    expect(m31.children).toHaveLength(2); // light + dark

    const m31Light = m31.children.find((c) => c.label === 'light')!;
    expect(m31Light.count).toBe(2);
    expect(m31Light.items).toHaveLength(2);
    expect(m31Light.children).toHaveLength(0);

    const m31Dark = m31.children.find((c) => c.label === 'dark')!;
    expect(m31Dark.count).toBe(1);
    expect(m31Dark.items[0].id).toBe('c');

    const ngc = result.find((n) => n.label === 'NGC 1234')!;
    expect(ngc.children).toHaveLength(1);
    expect(ngc.children[0].label).toBe('flat');
    expect(ngc.children[0].items).toHaveLength(1);
  });

  it('(4) items missing a dimension land in NONE_KEY group sorted last', () => {
    const items = [
      makeItem('a', 'M31', 'light'),
      makeItem('b', null, 'dark'),   // missing target
      makeItem('c', 'NGC 1234', 'light'),
    ];
    const result = groupByDimensions(items, ['target'], accessors);

    // All three groups present; none-group is last.
    const last = result[result.length - 1];
    expect(last.key).toBe(NONE_KEY);
    expect(last.items[0].id).toBe('b');

    // The other groups come before the none group.
    const nonNone = result.slice(0, -1);
    expect(nonNone.every((n) => n.key !== NONE_KEY)).toBe(true);
  });

  it('(4) items with empty string dimension also land in NONE_KEY group', () => {
    const items = [
      makeItem('a', 'M31', 'light'),
      makeItem('b', '', 'dark'), // empty string → treated as missing
    ];
    const result = groupByDimensions(items, ['target'], accessors);

    const last = result[result.length - 1];
    expect(last.key).toBe(NONE_KEY);
    expect(last.items[0].id).toBe('b');
  });

  it('(5) groups are sorted by label in numeric-aware ascending order', () => {
    const items = [
      makeItem('a', 'NGC 2359', 'light'),
      makeItem('b', 'NGC 10',   'light'),
      makeItem('c', 'M110',     'light'),
      makeItem('d', 'M31',      'light'),
      makeItem('e', 'M3',       'light'),
    ];
    const result = groupByDimensions(items, ['target'], accessors);

    const labels = result.map((n) => n.label);
    // Numeric-aware sort: M3 < M31 < M110 < NGC 10 < NGC 2359
    // (localeCompare with numeric: true)
    expect(labels).toEqual(['M3', 'M31', 'M110', 'NGC 10', 'NGC 2359']);
  });

  it('(5) NONE_KEY group is always last even when alphabetically first', () => {
    const items = [
      makeItem('a', null, 'light'),   // would sort as '(none)' = before 'Z...'
      makeItem('b', 'Ztarget', 'dark'),
    ];
    const result = groupByDimensions(items, ['target'], accessors);
    expect(result[result.length - 1].key).toBe(NONE_KEY);
    expect(result[0].label).toBe('Ztarget');
  });

  it('(7) unknown dimension (no accessor) is skipped, not applied', () => {
    const items = [
      makeItem('a', 'M31', 'light'),
      makeItem('b', 'NGC 1234', 'dark'),
    ];
    // 'unknownDim' has no accessor → should be skipped, leaving effectively
    // no active dimensions → one 'All' leaf.
    const result = groupByDimensions(items, ['unknownDim'], accessors);

    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('All');
    expect(result[0].count).toBe(2);
  });

  it('(7) mix of known and unknown dimensions: unknown dims are dropped', () => {
    const items = [
      makeItem('a', 'M31', 'light'),
      makeItem('b', 'M31', 'dark'),
      makeItem('c', 'NGC 1234', 'light'),
    ];
    // 'ghost' has no accessor; 'target' does.
    const result = groupByDimensions(items, ['ghost', 'target'], accessors);

    // Only 'target' active → 2 top-level groups, leaf items present.
    expect(result).toHaveLength(2);
    const m31 = result.find((n) => n.label === 'M31')!;
    expect(m31.items).toHaveLength(2);
  });
});

describe('groupByDimensions — count aggregation across nested levels', () => {
  it('inner-node count equals the sum of its leaf-descendant counts (3 levels)', () => {
    interface Tri {
      id: string;
      target: string | null;
      frameType: string | null;
      filter: string | null;
    }
    const triAccessors = {
      target: (i: Tri) => i.target,
      frameType: (i: Tri) => i.frameType,
      filter: (i: Tri) => i.filter,
    };
    const items: Tri[] = [
      { id: 'a', target: 'M31', frameType: 'light', filter: 'Ha' },
      { id: 'b', target: 'M31', frameType: 'light', filter: 'OIII' },
      { id: 'c', target: 'M31', frameType: 'light', filter: 'Ha' },
      { id: 'd', target: 'M31', frameType: 'dark', filter: null },
      { id: 'e', target: 'NGC 1', frameType: 'flat', filter: 'L' },
    ];
    const result = groupByDimensions(items, ['target', 'frameType', 'filter'], triAccessors);

    const m31 = result.find((n) => n.label === 'M31')!;
    expect(m31.count).toBe(4); // a,b,c,d
    expect(m31.items).toHaveLength(0); // inner node carries no items

    const m31Light = m31.children.find((c) => c.label === 'light')!;
    expect(m31Light.count).toBe(3); // a,b,c

    // Deepest level (filter): Ha=2 (a,c), OIII=1 (b). Sum == parent count.
    const ha = m31Light.children.find((c) => c.label === 'Ha')!;
    const oiii = m31Light.children.find((c) => c.label === 'OIII')!;
    expect(ha.count).toBe(2);
    expect(ha.items).toHaveLength(2);
    expect(oiii.count).toBe(1);
    expect(ha.count + oiii.count).toBe(m31Light.count);

    // The dark sub-frame has a missing filter → NONE bucket at the deepest level.
    const m31Dark = m31.children.find((c) => c.label === 'dark')!;
    expect(m31Dark.count).toBe(1);
    expect(m31Dark.children[m31Dark.children.length - 1].key).toBe(NONE_KEY);

    // Top-level sum equals total item count.
    const total = result.reduce((acc, n) => acc + n.count, 0);
    expect(total).toBe(items.length);
  });

  it('NONE bucket aggregates at an intermediate level too', () => {
    const items = [
      makeItem('a', 'M31', 'light'),
      makeItem('b', null, 'light'),   // missing target → NONE at level 1
      makeItem('c', null, 'dark'),    // missing target → NONE at level 1
    ];
    const result = groupByDimensions(items, ['target', 'frameType'], accessors);

    const none = result[result.length - 1];
    expect(none.key).toBe(NONE_KEY);
    expect(none.count).toBe(2); // b, c both nest under the NONE target
    // ...and split by frameType beneath it.
    expect(none.children).toHaveLength(2);
    const noneLight = none.children.find((c) => c.label === 'light')!;
    const noneDark = none.children.find((c) => c.label === 'dark')!;
    expect(noneLight.items[0].id).toBe('b');
    expect(noneDark.items[0].id).toBe('c');
  });
});

describe('flattenLeafItems', () => {
  it('(6) returns all leaf items from a single-level tree in order', () => {
    const items = [
      makeItem('a', 'M31', 'light'),
      makeItem('b', 'NGC 1234', 'light'),
    ];
    const nodes = groupByDimensions(items, ['target'], accessors);
    const flat = flattenLeafItems(nodes);
    // Two single-item leaves; sorted labels: M31 < NGC 1234
    expect(flat.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('(6) returns depth-first leaf items for a two-level tree', () => {
    const items = [
      makeItem('a', 'M31', 'dark'),
      makeItem('b', 'M31', 'light'),
      makeItem('c', 'M31', 'light'),
      makeItem('d', 'NGC 1234', 'flat'),
    ];
    const nodes = groupByDimensions(items, ['target', 'frameType'], accessors);
    const flat = flattenLeafItems(nodes);

    // M31 children sorted: dark < light → items: a, b, c; then NGC 1234/flat → d
    expect(flat.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('(6) handles empty node array without error', () => {
    expect(flattenLeafItems([])).toEqual([]);
  });

  it('(6) single All-leaf from empty dimensions returns all items', () => {
    const items = [makeItem('x', 'M31', 'light'), makeItem('y', null, null)];
    const nodes = groupByDimensions(items, [], accessors);
    const flat = flattenLeafItems(nodes);
    expect(flat).toHaveLength(2);
  });
});
