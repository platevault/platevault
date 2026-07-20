// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Inbox J/K triage navigation (spec 027 FR-022/SC-003, issue #747).
 *
 * The Inbox shipped with zero keyboard bindings, so the "triage 10 sessions
 * in under 60s" claim was false. These cover the binding contract the sweep
 * asked for: J/K step the selection through VISIBLE rows, the shortcuts stay
 * out of the way while typing, and the move is announced to a screen reader.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InboxList } from '../InboxList';
import type { InboxListItem } from '@/bindings/index';

function makeItem(
  over: Partial<InboxListItem> & { inboxItemId: string },
): InboxListItem {
  return {
    relativePath: over.inboxItemId,
    fileCount: 1,
    lane: 'fits',
    format: 'fits',
    state: 'classified',
    contentSignature: `sig-${over.inboxItemId}`,
    isMaster: false,
    masterFrameType: null,
    masterFilter: null,
    masterExposureS: null,
    rootAbsolutePath: '/lib/root',
    organizationState: 'unorganized',
    groupTarget: null,
    groupFrameType: null,
    groupDate: null,
    groupFilter: null,
    groupExposure: null,
    groupInstrument: null,
    groupId: over.inboxItemId,
    groupKey: 'type=dark',
    ...over,
  } as InboxListItem;
}

const ITEMS = [
  makeItem({ inboxItemId: 'a', frameType: 'dark' }),
  makeItem({ inboxItemId: 'b', frameType: 'dark' }),
  makeItem({ inboxItemId: 'c', frameType: 'dark' }),
];

function press(key: 'j' | 'k') {
  fireEvent.keyDown(window, {
    key,
    code: key === 'j' ? 'KeyJ' : 'KeyK',
  });
}

describe('InboxList — J/K triage navigation (#747)', () => {
  it('J selects the first row when nothing is selected yet', () => {
    const onSelect = vi.fn();
    render(
      <InboxList
        items={ITEMS}
        selectedId={null}
        onSelect={onSelect}
        filterType="all"
      />,
    );
    press('j');
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('K enters at the LAST row when nothing is selected yet', () => {
    const onSelect = vi.fn();
    render(
      <InboxList
        items={ITEMS}
        selectedId={null}
        onSelect={onSelect}
        filterType="all"
      />,
    );
    press('k');
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('J advances to the next row and K returns to the previous one', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <InboxList
        items={ITEMS}
        selectedId="a"
        onSelect={onSelect}
        filterType="all"
      />,
    );
    press('j');
    expect(onSelect).toHaveBeenLastCalledWith('b');

    rerender(
      <InboxList
        items={ITEMS}
        selectedId="b"
        onSelect={onSelect}
        filterType="all"
      />,
    );
    press('k');
    expect(onSelect).toHaveBeenLastCalledWith('a');
  });

  it('clamps at both ends rather than wrapping around', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <InboxList
        items={ITEMS}
        selectedId="c"
        onSelect={onSelect}
        filterType="all"
      />,
    );
    press('j');
    expect(onSelect).not.toHaveBeenCalled();

    rerender(
      <InboxList
        items={ITEMS}
        selectedId="a"
        onSelect={onSelect}
        filterType="all"
      />,
    );
    press('k');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not fire while the user is typing in a text field', () => {
    const onSelect = vi.fn();
    render(
      <>
        <input aria-label={'filter'} data-testid="typing-here" />
        <InboxList
          items={ITEMS}
          selectedId="a"
          onSelect={onSelect}
          filterType="all"
        />
      </>,
    );
    const input = screen.getByTestId('typing-here');
    input.focus();
    fireEvent.keyDown(input, { key: 'j', code: 'KeyJ' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('steps over rows hidden by a filter instead of selecting them', () => {
    // The Type filter hides row "b"; J from "a" must land on "c".
    const onSelect = vi.fn();
    render(
      <InboxList
        items={[
          makeItem({ inboxItemId: 'a', frameType: 'dark' }),
          makeItem({ inboxItemId: 'b', frameType: 'flat' }),
          makeItem({ inboxItemId: 'c', frameType: 'dark' }),
        ]}
        selectedId="a"
        onSelect={onSelect}
        filterType="all"
        kindFilter="dark"
      />,
    );
    press('j');
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('announces the selected row in a polite live region', () => {
    render(
      <InboxList
        items={ITEMS}
        selectedId="b"
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    const announcer = screen.getByTestId('inbox-selection-announcer');
    expect(announcer).toHaveAttribute('aria-live', 'polite');
    expect(announcer).toHaveTextContent('Selected: b');
  });

  it('makes the bindings discoverable in the list footer', () => {
    render(
      <InboxList
        items={ITEMS}
        selectedId={null}
        onSelect={vi.fn()}
        filterType="all"
      />,
    );
    expect(screen.getByTestId('inbox-hotkey-hint')).toHaveTextContent(
      /J \/ K.*C to confirm/i,
    );
  });
});
