/**
 * Multi-level grouping for the inbox review list (spec 041, US2 / FR-009).
 *
 * Groups a flat list of items into nested, collapsible groups over an ordered
 * list of dimensions (e.g. group by target, then frame type, then filter).
 * Generic over the item type via a map of dimension → accessor, so it has no
 * dependency on any particular DTO shape. Items missing a grouping dimension
 * are gathered under an explicit "none" group rather than dropped.
 */

import { m } from '@/lib/i18n';

/** Extracts the grouping key for one dimension from an item. */
export type DimensionAccessor<T> = (item: T) => string | number | null | undefined;

/** A node in the grouping tree. Leaf nodes carry `items`; inner nodes carry `children`. */
export interface GroupNode<T> {
  /** The dimension this level groups by (empty string for the synthetic leaf bucket). */
  dimension: string;
  /** Canonical key for this group at this level (`NONE_KEY` when the dimension is absent). */
  key: string;
  /** Human label for the group header. */
  label: string;
  /** Total number of items under this node (recursively). */
  count: number;
  /** Direct items — populated only at the deepest level. */
  items: T[];
  /** Nested groups for the next dimension — empty at the deepest level. */
  children: GroupNode<T>[];
}

/** Sentinel key/label for items missing a grouping dimension. */
export const NONE_KEY = '__none__';
const NONE_LABEL = '(none)';

function keyOf<T>(item: T, accessor: DimensionAccessor<T>): { key: string; label: string } {
  const raw = accessor(item);
  if (raw === null || raw === undefined || raw === '') {
    return { key: NONE_KEY, label: NONE_LABEL };
  }
  const s = String(raw);
  return { key: s, label: s };
}

/**
 * Group `items` into a nested tree over `dimensions` (in order), using
 * `accessors[dimension]` to read each item's value for a dimension.
 *
 * - An empty `dimensions` list returns a single flat leaf node containing all items.
 * - Unknown dimensions (no accessor) are skipped.
 * - Groups are sorted by label, with the "(none)" group always sorted last.
 * - `count` is the recursive item total under each node.
 */
export function groupByDimensions<T>(
  items: readonly T[],
  dimensions: readonly string[],
  accessors: Readonly<Record<string, DimensionAccessor<T>>>,
): GroupNode<T>[] {
  const activeDims = dimensions.filter((d) => typeof accessors[d] === 'function');

  // No grouping requested → one flat leaf bucket.
  if (activeDims.length === 0) {
    return [
      {
        dimension: '',
        key: '__all__',
        label: m.inbox_group_all_label(),
        count: items.length,
        items: [...items],
        children: [],
      },
    ];
  }

  return buildLevel([...items], activeDims, 0, accessors);
}

function buildLevel<T>(
  items: T[],
  dimensions: readonly string[],
  depth: number,
  accessors: Readonly<Record<string, DimensionAccessor<T>>>,
): GroupNode<T>[] {
  const dimension = dimensions[depth];
  const accessor = accessors[dimension];
  const isLeaf = depth === dimensions.length - 1;

  // Partition items by this dimension's key, preserving first-seen order.
  const buckets = new Map<string, { label: string; items: T[] }>();
  for (const item of items) {
    const { key, label } = keyOf(item, accessor);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.items.push(item);
    } else {
      buckets.set(key, { label, items: [item] });
    }
  }

  const nodes: GroupNode<T>[] = [];
  for (const [key, { label, items: bucketItems }] of buckets) {
    nodes.push({
      dimension,
      key,
      label,
      count: bucketItems.length,
      items: isLeaf ? bucketItems : [],
      children: isLeaf ? [] : buildLevel(bucketItems, dimensions, depth + 1, accessors),
    });
  }

  // Sort by label; keep the "(none)" bucket last.
  nodes.sort((a, b) => {
    if (a.key === NONE_KEY) return 1;
    if (b.key === NONE_KEY) return -1;
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
  });

  return nodes;
}

/** Flatten a group tree into the leaf items in display order (depth-first). */
export function flattenLeafItems<T>(nodes: readonly GroupNode<T>[]): T[] {
  const out: T[] = [];
  const walk = (n: GroupNode<T>) => {
    out.push(...n.items);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}
