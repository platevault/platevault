// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plan-summary path helpers (bd astro-plan-3pvvc).
 *
 * A plan action's `fromPath` and `destinationPreview` are wire text: `/` is
 * the only separator, and on macOS and Linux a `\` is part of a name. The
 * absolute destination from the confirm response is a native path, where `\`
 * separates only under a Windows drive or UNC path.
 */

import { describe, expect, it } from 'vitest';
import {
  actionDestination,
  breakdownDestination,
  buildGroupSummary,
  frameTypeLabel,
} from '../planPanelHelpers';
import type { InboxPlanAction } from '../store';

function action(overrides: Partial<InboxPlanAction>): InboxPlanAction {
  return {
    index: 1,
    action: 'move',
    fromPath: 'in/img.fits',
    toPath: 'lights/img.fits',
    destinationPreview: 'lights/img.fits',
    requiresDestructiveConfirm: false,
    ...overrides,
  };
}

describe('plan summary destinations', () => {
  it('keep a backslash in a file name of a relative preview', () => {
    const actions = [
      action({
        fromPath: 'folder/a\\b.fits',
        destinationPreview: 'folder/a\\b.fits',
      }),
    ];
    const [line] = buildGroupSummary(actions, undefined, 'light');
    expect(line.destinationFull).toBe('folder');
    expect(line.destinationShort).toBe('folder');
    expect(breakdownDestination(actions, 'folder')).toEqual({
      short: 'folder',
      full: 'folder',
    });
  });

  it('keep a backslash in a name of a macOS or Linux absolute destination', () => {
    const a = action({ fromPath: 'in/a\\b.fits' });
    const absolute = { 'in/a\\b.fits': '/lib/lights/x\\y/a\\b.fits' };
    expect(actionDestination(a, absolute)).toBe('/lib/lights/x\\y/a\\b.fits');
    const [line] = buildGroupSummary([a], absolute, 'light');
    expect(line.destinationFull).toBe('/lib/lights/x\\y');
    expect(line.destinationShort).toBe('…/lights/x\\y');
  });

  it('split a Windows absolute destination on both separators', () => {
    const a = action({ fromPath: 'in/img.fits' });
    const absolute = { 'in/img.fits': 'C:\\lib\\darks\\img.fits' };
    expect(actionDestination(a, absolute)).toBe('C:/lib/darks/img.fits');
    const [line] = buildGroupSummary([a], absolute);
    expect(line.destinationFull).toBe('C:/lib/darks');
    expect(line.destinationShort).toBe('…/lib/darks');
    expect(line.frameType).toBe('dark');
  });
});

describe('frameTypeLabel from path keywords', () => {
  it('does not read a keyword out of a name containing a backslash', () => {
    const a = action({
      fromPath: 'in/img.fits',
      destinationPreview: 'lights\\x/img.fits',
    });
    expect(frameTypeLabel(a, actionDestination(a), 'dark')).toBe('dark');
  });

  it('still reads a keyword from a folder of the destination', () => {
    const a = action({ destinationPreview: 'masters/darks/img.fits' });
    expect(frameTypeLabel(a, actionDestination(a), 'light')).toBe('dark');
  });
});
