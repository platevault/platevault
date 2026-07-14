// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Multi-level grouping — shared across every list page (promoted from the
 * Inbox, spec 041 US2/FR-009). Groups a flat list into nested, collapsible
 * groups over an ordered list of dimensions. Generic over the item type via a
 * map of dimension → accessor, so it has no dependency on any DTO shape. Items
 * missing a grouping dimension are gathered under an explicit "(none)" group.
 */

import { m } from '@/lib/i18n';

/** Extracts the grouping key for one dimension from an item. */
export type DimensionAccessor<T> = (
  item: T,
) => string | number | null | undefined;

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

/** Sentinel key for items missing a grouping dimension. */
export const NONE_KEY = '__none__';

function keyOf<T>(
  item: T,
  accessor: DimensionAccessor<T>,
): { key: string; label: string } {
  const raw = accessor(item);
  if (raw === null || raw === undefined || raw === '') {
    // Call-time, not a module-level const, so the label re-reads the active
    // locale (spec 046 #8) instead of freezing it at import.
    return { key: NONE_KEY, label: m.grouping_none_label() };
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
  const activeDims = dimensions.filter(
    (d) => typeof accessors[d] === 'function',
  );

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
      children: isLeaf
        ? []
        : buildLevel(bucketItems, dimensions, depth + 1, accessors),
    });
  }

  nodes.sort((a, b) => {
    if (a.key === NONE_KEY) return 1;
    if (b.key === NONE_KEY) return -1;
    return a.label.localeCompare(b.label, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
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

// ── Visible-row flattening (group headers + leaves, honouring collapse) ──────────

/** A visible row in a grouped list: a collapsible header or a leaf item. */
export type VisibleGroupRow<T> =
  | {
      kind: 'header';
      /** Stable collapse key (also a good React key for the row). */
      path: string;
      node: GroupNode<T>;
      depth: number;
      collapsed: boolean;
    }
  | { kind: 'item'; item: T; depth: number };

/**
 * Walk the group tree in render order, emitting every group header plus the
 * leaf items of groups that are not collapsed. A collapsed group contributes
 * only its header. `depth` drives indentation; `path` is the collapse key.
 */
export function flattenVisibleGroups<T>(
  nodes: readonly GroupNode<T>[],
  collapsed: ReadonlySet<string>,
): VisibleGroupRow<T>[] {
  const rows: VisibleGroupRow<T>[] = [];
  const walk = (ns: readonly GroupNode<T>[], depth: number, prefix: string) => {
    for (const node of ns) {
      const path = `${prefix}/${node.dimension}:${node.key}`;
      const isCollapsed = collapsed.has(path);
      rows.push({ kind: 'header', path, node, depth, collapsed: isCollapsed });
      if (isCollapsed) continue;
      if (node.children.length > 0) {
        walk(node.children, depth + 1, path);
      } else {
        for (const item of node.items)
          rows.push({ kind: 'item', item, depth: depth + 1 });
      }
    }
  };
  walk(nodes, 0, 'root');
  return rows;
}
