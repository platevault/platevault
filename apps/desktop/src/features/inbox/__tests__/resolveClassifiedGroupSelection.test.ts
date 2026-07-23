// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CHK011 (spec 058 T017 / FR-023): selection after a source-group row is
 * replaced by the items classification materialized from it.
 *
 * The load-bearing case is N > 1. Selecting one of several siblings would
 * silently designate a primary — exactly what D-002 forbids and what #1102
 * deleted `ids.next()` to avoid. "Select nothing" is therefore the correct
 * answer today, not a placeholder for one: the folder group header CHK011 names
 * belongs to T034's grouping UI, and until it exists there is no correct row to
 * land on.
 */

import { describe, it, expect } from 'vitest';
import { resolveClassifiedGroupSelection } from '../InboxPage';

const item = (id: string, sourceGroupId: string | null) => ({
  inboxItemId: id,
  sourceGroupId,
});

describe('resolveClassifiedGroupSelection (CHK011)', () => {
  it('waits while the list is still loading', () => {
    // Deciding on an in-flight refetch would read "not arrived yet" as "never
    // arrived" and give up on a folder that is about to appear.
    expect(
      resolveClassifiedGroupSelection('sg-1', [item('a', 'sg-1')], true),
    ).toEqual({ action: 'wait' });
  });

  it('selects the single item a folder resolved to (N = 1)', () => {
    expect(
      resolveClassifiedGroupSelection(
        'sg-1',
        [item('only-one', 'sg-1'), item('other', 'sg-2')],
        false,
      ),
    ).toEqual({ action: 'select', id: 'only-one' });
  });

  it('selects NOTHING when the folder split into siblings (N > 1)', () => {
    // If this ever returns `select`, a sibling has been designated primary.
    const decision = resolveClassifiedGroupSelection(
      'sg-1',
      [item('light', 'sg-1'), item('dark', 'sg-1'), item('elsewhere', 'sg-2')],
      false,
    );
    expect(decision).toEqual({ action: 'none' });
    expect(decision).not.toHaveProperty('id');
  });

  it('selects nothing when classification produced no items (N = 0)', () => {
    // A source-group row was never selectable (FR-016), so there is no prior
    // selection to restore and nothing is lost by selecting nothing.
    expect(
      resolveClassifiedGroupSelection('sg-1', [item('other', 'sg-2')], false),
    ).toEqual({ action: 'none' });
  });

  it('ignores items whose sourceGroupId is null', () => {
    // Master items carry a NULL source group (FR-015 carve-out). One sitting in
    // the list must not be mistaken for the classified folder's only sibling.
    expect(
      resolveClassifiedGroupSelection(
        'sg-1',
        [item('master', null), item('real', 'sg-1')],
        false,
      ),
    ).toEqual({ action: 'select', id: 'real' });
  });
});
