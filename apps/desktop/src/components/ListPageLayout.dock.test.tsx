// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ListPageLayout adaptive-placement wiring tests — spec 054 T005.
 *
 * Mocks `useDetailDock` directly (rather than driving it through real width
 * measurement — that's `useDetailDock.test.ts`'s job) to assert ListPageLayout
 * mounts the detail in the region the hook resolves, for all three shapes,
 * and always exposes `.alm-listpage__detail` so existing e2e locators keep
 * resolving regardless of placement (FR-001/FR-004).
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

describe('ListPageLayout + useDetailDock wiring', () => {
  it('mounts the bottom dock when the hook resolves bottom', () => {
    mockPlacement('bottom');
    const { container } = render(
      <ListPageLayout
        topBar={<div>bar</div>}
        dockPage="sessions"
        detail={<div>detail</div>}
      >
        <div>main</div>
      </ListPageLayout>,
    );
    expect(container.querySelector('.alm-listpage__body')).not.toHaveClass(
      'alm-listpage__body--side',
    );
    expect(container.querySelector('.alm-listpage__body')).not.toHaveClass(
      'alm-listpage__body--split',
    );
    expect(
      container.querySelector('.alm-listpage__detail'),
    ).toBeInTheDocument();
  });

  it('mounts the side dock when the hook resolves side', () => {
    mockPlacement('side');
    const { container } = render(
      <ListPageLayout
        topBar={<div>bar</div>}
        dockPage="targets"
        detail={<div>detail</div>}
      >
        <div>main</div>
      </ListPageLayout>,
    );
    expect(container.querySelector('.alm-listpage__body')).toHaveClass(
      'alm-listpage__body--side',
    );
    const detail = container.querySelector('.alm-listpage__detail');
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveClass('alm-listpage__detail--side');
  });

  it('mounts the split shape when the hook resolves split', () => {
    mockPlacement('split');
    const { container } = render(
      <ListPageLayout
        topBar={<div>bar</div>}
        dockPage="inbox"
        detail={<div>detail</div>}
      >
        <div>main</div>
      </ListPageLayout>,
    );
    expect(container.querySelector('.alm-listpage__body')).toHaveClass(
      'alm-listpage__body--split',
    );
    const detail = container.querySelector('.alm-listpage__detail');
    expect(detail).toBeInTheDocument();
    expect(detail).toHaveClass('alm-listpage__detail--split');
  });

  it('exposes .alm-listpage__detail in every placement (existing e2e locators)', () => {
    for (const placement of ['bottom', 'side', 'split'] as const) {
      mockPlacement(placement);
      const { unmount } = render(
        <ListPageLayout
          topBar={<div>bar</div>}
          dockPage="sessions"
          detail={<div>detail</div>}
        >
          <div>main</div>
        </ListPageLayout>,
      );
      expect(
        screen.getByText('detail').closest('.alm-listpage__detail'),
      ).not.toBeNull();
      unmount();
    }
  });

  it('does not consult useDetailDock for placement when dockPage is omitted (legacy static path)', () => {
    mockPlacement('side'); // would flip the body class if (wrongly) consulted
    const { container } = render(
      <ListPageLayout topBar={<div>bar</div>} detail={<div>detail</div>}>
        <div>main</div>
      </ListPageLayout>,
    );
    expect(container.querySelector('.alm-listpage__body')).not.toHaveClass(
      'alm-listpage__body--side',
    );
  });
});
