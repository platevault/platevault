// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * deriveInboxStats — reconciled stats from the inbox item list.
 *
 * Regression: the backend `inbox.stats` double-counted a mixed "(root)" folder
 * across frame types, so the stats strip showed "6 Folders" while the header
 * and footer (which count distinct items via isMaster) showed "3 folders".
 * These tests pin the distinct-folder invariant: every folder is counted once,
 * so the stats-strip total and the per-type tallies reconcile with the header.
 */

import { describe, it, expect } from 'vitest';
import { deriveInboxStats } from './inboxStatsFromItems';
import type { InboxListItem, InboxSourceGroupListItem } from '@/bindings/index';

function sourceGroup(id: string, files: number): InboxSourceGroupListItem {
  return {
    sourceGroupId: id,
    rootId: 'r1',
    rootAbsolutePath: '/lib',
    relativePath: id,
    fileCount: files,
    format: 'fits',
    lane: 'move',
    contentSignature: `sig-${id}`,
    discoveredAt: '2026-07-20T00:00:00Z',
  };
}

function folder(
  id: string,
  frameType: string | null,
  files: number,
): InboxListItem {
  return {
    inboxItemId: id,
    groupId: id,
    groupKey: '',
    needsReview: false,
    rootId: 'r1',
    rootAbsolutePath: '/lib',
    relativePath: id,
    fileCount: files,
    lane: 'inbox',
    format: 'fits',
    state: 'classified',
    contentSignature: 'sig',
    isMaster: false,
    masterFrameType: null,
    masterFilter: null,
    masterExposureS: null,
    organizationState: 'unorganized',
    groupTarget: null,
    groupFrameType: frameType,
    groupDate: null,
    groupFilter: null,
    groupExposure: null,
    groupInstrument: null,
  };
}

function master(id: string, frameType: string | null): InboxListItem {
  return { ...folder(id, null, 1), isMaster: true, masterFrameType: frameType };
}

describe('deriveInboxStats', () => {
  it('counts each folder once; total folders equals sum of per-type folderCount', () => {
    // 3 folders: bias, dark, light + 1 "mixed"-typed folder + 3 masters.
    const items = [
      folder('bias', 'bias', 10),
      folder('dark', 'dark', 20),
      folder('light', 'light', 28),
      master('m-dark-1', 'dark'),
      master('m-flat-1', 'flat'),
      master('m-bias-1', 'bias'),
    ];

    const stats = deriveInboxStats(items);

    expect(stats.totals.folders).toBe(3);
    expect(stats.totals.masters).toBe(3);
    expect(stats.totals.images).toBe(10 + 20 + 28 + 3);

    const folderSum = stats.perType.reduce((n, r) => n + r.folderCount, 0);
    const masterSum = stats.perType.reduce((n, r) => n + r.masterCount, 0);
    expect(folderSum).toBe(stats.totals.folders);
    expect(masterSum).toBe(stats.totals.masters);
  });

  it('counts a mixed/untyped folder exactly once under a single "unresolved" bucket', () => {
    const items = [
      folder('a', 'Mixed', 5),
      folder('b', null, 5),
      folder('c', 'light', 5),
    ];

    const stats = deriveInboxStats(items);

    expect(stats.totals.folders).toBe(3);
    const unresolved = stats.perType.find((r) => r.frameType === 'unresolved');
    expect(unresolved?.folderCount).toBe(2);
    const folderSum = stats.perType.reduce((n, r) => n + r.folderCount, 0);
    expect(folderSum).toBe(3);
  });

  /**
   * Spec 058 T022 / CHK010 — source-group rows ARE counted.
   *
   * The list renders a scanned-but-unclassified folder as a row, so a summary
   * that skipped it would report fewer rows than the user can see. That is
   * SC-004's exact failure mode, just in the opposite direction from the
   * original double-count.
   *
   * Two-direction control (recorded 2026-07-20): deleting the `sourceGroups`
   * loop in `deriveInboxStats` fails this with
   * `expected 1 to be 3 // Object.is equality` on `totals.folders`; restoring
   * it passes. The reconciliation assertion below fails in the same direction.
   */
  it('(CHK010) counts source groups as unresolved folders and still reconciles', () => {
    const stats = deriveInboxStats(
      [folder('a', 'light', 5)],
      [sourceGroup('sg-1', 7), sourceGroup('sg-2', 2)],
    );

    expect(stats.totals.folders).toBe(3);
    expect(stats.totals.masters).toBe(0);
    expect(stats.totals.images).toBe(5 + 7 + 2);

    const unresolved = stats.perType.find((r) => r.frameType === 'unresolved');
    expect(unresolved?.folderCount).toBe(2);
    expect(unresolved?.imageCount).toBe(9);

    // The invariant the whole helper exists to hold.
    const folderSum = stats.perType.reduce((n, r) => n + r.folderCount, 0);
    expect(folderSum).toBe(stats.totals.folders);
  });

  it('is unchanged when no source groups are supplied (the state until T020)', () => {
    const items = [folder('a', 'light', 5)];
    expect(deriveInboxStats(items)).toEqual(deriveInboxStats(items, []));
  });

  // #791: this bucket must NOT be named/labelled "mixed" — that word is
  // reserved for the unrelated per-item "mixed folder" concept (a folder
  // whose files genuinely span more than one frame type) shown in the detail
  // pane. This bucket is items with NO resolved dominant type at all yet.
  it('does not use the word "mixed" as a bucket key', () => {
    const stats = deriveInboxStats([folder('a', 'Mixed', 5)]);
    expect(stats.perType.map((r) => r.frameType)).not.toContain('mixed');
  });

  it('normalises frame-type case and orders "unresolved" last', () => {
    const stats = deriveInboxStats([
      folder('x', 'LIGHT', 1),
      folder('y', null, 1),
      folder('z', 'dark', 1),
    ]);
    expect(stats.perType.map((r) => r.frameType)).toEqual([
      'dark',
      'light',
      'unresolved',
    ]);
  });

  // #625: "Dark_flat 1 · Darkflat 6" — an unnormalised underscore variant of
  // the same IMAGETYP value leaked into the status bar as two sibling
  // categories instead of one normalized category.
  it('collapses underscore/hyphen/space variants of the same frame type into one bucket', () => {
    const stats = deriveInboxStats([
      folder('a', 'Dark_flat', 1),
      folder('b', 'Darkflat', 6),
      folder('c', 'dark-flat', 2),
      folder('d', 'dark flat', 3),
    ]);
    const rows = stats.perType.filter((r) => r.frameType === 'darkflat');
    expect(rows).toHaveLength(1);
    expect(rows[0].folderCount).toBe(4);
  });

  it('returns zero totals and no rows for an empty list', () => {
    const stats = deriveInboxStats([]);
    expect(stats.totals).toEqual({ folders: 0, masters: 0, images: 0 });
    expect(stats.perType).toEqual([]);
  });
});
