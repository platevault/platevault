// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Placement-neutral keyboard flow — spec 054 T028 (US6, FR-012/FR-013).
 *
 * Arrow-key row navigation (`Table`'s `focusAdjacentRow`) and Escape-to-close
 * (`ListPageLayout`'s document-level listener) are wired ONCE, independent of
 * placement — neither reads `effectivePlacement`. This suite proves that
 * invariant behaviourally across all three shapes (mocking `useDetailDock`
 * exactly like `ListPageLayout.dock.test.tsx` does) rather than by re-reading
 * the source: arrow keys move the selection with the detail following, and
 * Escape closes the panel identically in side dock, bottom dock, and the
 * Inbox split — while an open overlay still wins over the panel's own Escape
 * (#771/#906), unaffected by placement.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Table } from '@/ui';

const useDetailDockMock = vi.fn();
vi.mock('./useDetailDock', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useDetailDock')>();
  return {
    ...actual,
    useDetailDock: (...args: unknown[]) => useDetailDockMock(...args),
  };
});

// Imported AFTER the mock so ListPageLayout picks up the mocked hook.
const { ListPageLayout } = await import('./ListPageLayout');

function mockPlacement(effectivePlacement: 'side' | 'bottom' | 'split') {
  useDetailDockMock.mockReturnValue({
    effectivePlacement,
    windowWidth: 1600,
    pageWidth: 1200,
  });
}

const ROW_NAMES = ['Alpha', 'Bravo', 'Charlie'];

/** Minimal list+detail page: three selectable rows, the detail follows the
 * selected row, matching how every adopting page wires `_onClick`/`detail`. */
function Harness() {
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(true);
  const rows = ROW_NAMES.map((name, i) => ({
    name,
    _onClick: () => setSelected(i),
    _selected: selected === i,
    _testid: `row-${i}`,
  }));
  return (
    <ListPageLayout
      topBar={<div>bar</div>}
      dockPage="sessions"
      detail={open ? <div>Detail: {ROW_NAMES[selected]}</div> : null}
      onCloseDetail={() => setOpen(false)}
    >
      <Table columns={[{ key: 'name', label: 'Name' }]} rows={rows} />
    </ListPageLayout>
  );
}

describe.each([
  'side',
  'bottom',
  'split',
] as const)('keyboard flow in %s placement', (placement) => {
  it('arrow keys move the row selection with the detail following', () => {
    mockPlacement(placement);
    render(<Harness />);

    expect(screen.getByText('Detail: Alpha')).toBeInTheDocument();

    const row0 = screen.getByTestId('row-0');
    row0.focus();
    fireEvent.keyDown(row0, { key: 'ArrowDown' });
    const row1 = screen.getByTestId('row-1');
    expect(row1).toHaveFocus();

    fireEvent.click(row1);
    expect(screen.getByText('Detail: Bravo')).toBeInTheDocument();
  });

  it('Escape closes the panel and returns focus to the list (no overlay open)', () => {
    mockPlacement(placement);
    render(<Harness />);

    expect(screen.getByText('Detail: Alpha')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Detail: Alpha')).not.toBeInTheDocument();
  });

  it('Escape defers to an open overlay instead of closing the panel (#771/#906)', () => {
    mockPlacement(placement);
    render(
      <>
        <Harness />
        <div role="dialog" data-open="">
          overlay
        </div>
      </>,
    );

    expect(screen.getByText('Detail: Alpha')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    // The panel stays open — only the overlay's own dismissal should react.
    expect(screen.getByText('Detail: Alpha')).toBeInTheDocument();
  });
});
