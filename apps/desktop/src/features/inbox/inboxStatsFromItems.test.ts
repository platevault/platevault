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
import type { InboxListItem } from '@/bindings/index';

function folder(id: string, frameType: string | null, files: number): InboxListItem {
  return {
    inboxItemId: id,
    groupId: id,
    groupKey: '',
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

  it('counts a mixed/untyped folder exactly once under a single "mixed" bucket', () => {
    const items = [
      folder('a', 'Mixed', 5),
      folder('b', null, 5),
      folder('c', 'light', 5),
    ];

    const stats = deriveInboxStats(items);

    expect(stats.totals.folders).toBe(3);
    const mixed = stats.perType.find((r) => r.frameType === 'mixed');
    expect(mixed?.folderCount).toBe(2);
    const folderSum = stats.perType.reduce((n, r) => n + r.folderCount, 0);
    expect(folderSum).toBe(3);
  });

  it('normalises frame-type case and orders "mixed" last', () => {
    const stats = deriveInboxStats([
      folder('x', 'LIGHT', 1),
      folder('y', null, 1),
      folder('z', 'dark', 1),
    ]);
    expect(stats.perType.map((r) => r.frameType)).toEqual(['dark', 'light', 'mixed']);
  });

  it('returns zero totals and no rows for an empty list', () => {
    const stats = deriveInboxStats([]);
    expect(stats.totals).toEqual({ folders: 0, masters: 0, images: 0 });
    expect(stats.perType).toEqual([]);
  });
});
