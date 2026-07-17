// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ListPageLayout tests — spec 043 tasks #94 / #104.
 *
 * Covers the `detailPlacement` prop: the DEFAULT `'bottom'` dock keeps the
 * existing classes (Sessions/Calibration/Targets are unchanged), while `'side'`
 * switches the body + detail to the right-side-panel variant classes. Both keep
 * role=complementary, the detailLabel, and the close ✕ affordance.
 *
 * Task #104 adds coverage for `detailPlacement="side-and-bottom"`: the dual
 * layout renders both a side panel (from `detail`) and a bottom strip (from
 * `bottomDetail`), each with their own aria label and close affordance.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListPageLayout } from './ListPageLayout';
import { Modal } from './Modal';
import { Combobox } from '@base-ui-components/react/combobox';

/** Simulate a browser window resize for the adaptive-dock hook (jsdom
 * doesn't resize on its own — `window.innerWidth` must be forced). */
function resizeWindowTo(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    writable: true,
    configurable: true,
    value: width,
  });
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
}

describe('ListPageLayout', () => {
  it('defaults to the bottom dock (no side variant classes)', () => {
    const { container } = render(
      <ListPageLayout topBar={<div>bar</div>} detail={<div>detail</div>}>
        <div>main</div>
      </ListPageLayout>,
    );
    const body = container.querySelector('.alm-listpage__body');
    expect(body).toBeInTheDocument();
    expect(body).not.toHaveClass('alm-listpage__body--side');
    const detail = container.querySelector('.alm-listpage__detail');
    expect(detail).toBeInTheDocument();
    expect(detail).not.toHaveClass('alm-listpage__detail--side');
  });

  it('does not render the detail panel when detail is null', () => {
    const { container } = render(
      <ListPageLayout topBar={<div>bar</div>}>
        <div>main</div>
      </ListPageLayout>,
    );
    expect(container.querySelector('.alm-listpage__detail')).toBeNull();
  });

  it('applies the side variant classes when detailPlacement="side"', () => {
    const { container } = render(
      <ListPageLayout
        topBar={<div>bar</div>}
        detail={<div>detail</div>}
        detailPlacement="side"
        detailLabel="Project details"
      >
        <div>main</div>
      </ListPageLayout>,
    );
    expect(container.querySelector('.alm-listpage__body')).toHaveClass(
      'alm-listpage__body--side',
    );
    expect(container.querySelector('.alm-listpage__detail')).toHaveClass(
      'alm-listpage__detail--side',
    );
  });

  it('keeps role=complementary + detailLabel + close affordance in the side variant', () => {
    const onClose = vi.fn();
    render(
      <ListPageLayout
        topBar={<div>bar</div>}
        detail={<div>detail</div>}
        detailPlacement="side"
        detailLabel="Project details"
        onCloseDetail={onClose}
      >
        <div>main</div>
      </ListPageLayout>,
    );
    const region = screen.getByRole('complementary', {
      name: 'Project details',
    });
    expect(region).toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Close details' });
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ── Task #104: side-and-bottom dual layout ───────────────────────────────

  it('(#104) dual: renders side panel from detail and bottom strip from bottomDetail', () => {
    const { container } = render(
      <ListPageLayout
        topBar={<div>bar</div>}
        detail={<div>side content</div>}
        bottomDetail={<div>bottom content</div>}
        detailPlacement="side-and-bottom"
        detailLabel="Project details"
        bottomDetailLabel="Selected item details"
      >
        <div>main</div>
      </ListPageLayout>,
    );
    // Both regions are present.
    expect(
      screen.getByRole('complementary', { name: 'Project details' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('complementary', { name: 'Selected item details' }),
    ).toBeInTheDocument();
    // Body carries the dual modifier class.
    expect(
      container.querySelector('.alm-listpage__body--dual'),
    ).toBeInTheDocument();
    // Side panel and bottom strip use their own classes (not the old detail classes).
    expect(container.querySelector('.alm-listpage__side')).toBeInTheDocument();
    expect(
      container.querySelector('.alm-listpage__bottom'),
    ).toBeInTheDocument();
    expect(screen.getByText('side content')).toBeInTheDocument();
    expect(screen.getByText('bottom content')).toBeInTheDocument();
  });

  it('(#104) dual: does not render side panel when detail is null', () => {
    const { container } = render(
      <ListPageLayout
        topBar={<div>bar</div>}
        bottomDetail={<div>bottom content</div>}
        detailPlacement="side-and-bottom"
      >
        <div>main</div>
      </ListPageLayout>,
    );
    expect(container.querySelector('.alm-listpage__side')).toBeNull();
    expect(
      container.querySelector('.alm-listpage__bottom'),
    ).toBeInTheDocument();
  });

  it('(#104) dual: does not render bottom strip when bottomDetail is null', () => {
    const { container } = render(
      <ListPageLayout
        topBar={<div>bar</div>}
        detail={<div>side content</div>}
        detailPlacement="side-and-bottom"
        detailLabel="Project details"
      >
        <div>main</div>
      </ListPageLayout>,
    );
    expect(container.querySelector('.alm-listpage__side')).toBeInTheDocument();
    expect(container.querySelector('.alm-listpage__bottom')).toBeNull();
  });

  it('(#104) dual: close affordances call their respective callbacks', () => {
    const onCloseSide = vi.fn();
    const onCloseBottom = vi.fn();
    render(
      <ListPageLayout
        topBar={<div>bar</div>}
        detail={<div>side content</div>}
        bottomDetail={<div>bottom content</div>}
        detailPlacement="side-and-bottom"
        detailLabel="Project details"
        bottomDetailLabel="Selected item details"
        onCloseDetail={onCloseSide}
        onCloseBottomDetail={onCloseBottom}
      >
        <div>main</div>
      </ListPageLayout>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onCloseSide).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole('button', { name: 'Close session details' }),
    );
    expect(onCloseBottom).toHaveBeenCalledTimes(1);
  });

  it('(#104) dual: backward-compatible — existing bottom/side paths unaffected', () => {
    // Sessions/Calibration/Targets use detailPlacement="bottom" (default) —
    // ensure they still get the original class names with no dual classes.
    const { container } = render(
      <ListPageLayout topBar={<div>bar</div>} detail={<div>detail</div>}>
        <div>main</div>
      </ListPageLayout>,
    );
    expect(container.querySelector('.alm-listpage__body--dual')).toBeNull();
    expect(container.querySelector('.alm-listpage__side')).toBeNull();
    expect(container.querySelector('.alm-listpage__bottom')).toBeNull();
    // Original detail class still present.
    expect(
      container.querySelector('.alm-listpage__detail'),
    ).toBeInTheDocument();
  });

  // ── Escape-to-close (#771) ────────────────────────────────────────────────

  it('closes the bottom-dock detail on Escape, even with focus on <body>', () => {
    const onClose = vi.fn();
    render(
      <ListPageLayout
        topBar={<div>bar</div>}
        detail={<div>detail</div>}
        onCloseDetail={onClose}
      >
        <div>main</div>
      </ListPageLayout>,
    );
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the side-dock detail on Escape when focus is inside the panel', () => {
    const onClose = vi.fn();
    render(
      <ListPageLayout
        topBar={<div>bar</div>}
        detail={<button type="button">focus me</button>}
        detailPlacement="side"
        onCloseDetail={onClose}
      >
        <div>main</div>
      </ListPageLayout>,
    );
    screen.getByText('focus me').focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close the panel on Escape while a Base UI Modal is open above it (#906)', () => {
    const onCloseDetail = vi.fn();
    const onCloseModal = vi.fn();
    render(
      <>
        <ListPageLayout
          topBar={<div>bar</div>}
          detail={<div>detail</div>}
          onCloseDetail={onCloseDetail}
        >
          <div>main</div>
        </ListPageLayout>
        <Modal open onClose={onCloseModal} title="Overlay">
          <div>modal body</div>
        </Modal>
      </>,
    );
    // Base UI stamps the open popup with `data-open` + role="dialog" — the
    // same signal our overlay guard checks for.
    expect(
      document.querySelector('[data-open][role="dialog"]'),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    // The panel must NOT also close — only the modal's own dismissal should
    // react to this Escape (asserted separately from Base UI's own listener,
    // which isn't under test here; the regression is that our listener used
    // to co-fire regardless).
    expect(onCloseDetail).not.toHaveBeenCalled();
  });

  it('does not close the panel on Escape while a Base UI Combobox is open above it (#906)', () => {
    const onCloseDetail = vi.fn();
    render(
      <>
        <ListPageLayout
          topBar={<div>bar</div>}
          detail={<div>detail</div>}
          onCloseDetail={onCloseDetail}
        >
          <div>main</div>
        </ListPageLayout>
        <Combobox.Root items={['Alpha', 'Beta']} open>
          <Combobox.Input aria-label="Search" />
          <Combobox.Portal keepMounted>
            <Combobox.Positioner>
              <Combobox.Popup>
                <Combobox.List>
                  {(item: string) => (
                    <Combobox.Item key={item} value={item}>
                      {item}
                    </Combobox.Item>
                  )}
                </Combobox.List>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      </>,
    );
    // Combobox splits the signal across two nodes: `role="listbox"` sits on
    // the List, `data-open` on its Positioner/Popup ancestor — neither node
    // carries both, which is exactly what our overlay guard must handle.
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).toBeInTheDocument();
    expect(listbox).not.toHaveAttribute('data-open');
    expect(listbox?.closest('[data-open]')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseDetail).not.toHaveBeenCalled();
  });

  it('does not call onCloseDetail on Escape when no detail is open', () => {
    const onClose = vi.fn();
    render(
      <ListPageLayout topBar={<div>bar</div>} onCloseDetail={onClose}>
        <div>main</div>
      </ListPageLayout>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on Escape when an inner handler already consumed it', () => {
    const onClose = vi.fn();
    render(
      <ListPageLayout
        topBar={<div>bar</div>}
        detail={
          <input
            aria-label="inner"
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.preventDefault();
            }}
          />
        }
        onCloseDetail={onClose}
      >
        <div>main</div>
      </ListPageLayout>,
    );
    fireEvent.keyDown(screen.getByLabelText('inner'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores non-Escape keys', () => {
    const onClose = vi.fn();
    render(
      <ListPageLayout
        topBar={<div>bar</div>}
        detail={<div>detail</div>}
        onCloseDetail={onClose}
      >
        <div>main</div>
      </ListPageLayout>,
    );
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Adaptive dock (spec 054 / #936) ──────────────────────────────────────

  describe('adaptive dock', () => {
    const originalInnerWidth = window.innerWidth;

    beforeEach(() => {
      window.localStorage.clear();
    });

    afterEach(() => {
      resizeWindowTo(originalInnerWidth);
    });

    it('docks to the bottom under the threshold and to the side at/above it', () => {
      resizeWindowTo(1024);
      const { container, rerender } = render(
        <ListPageLayout
          topBar={<div>bar</div>}
          detail={<div>detail</div>}
          dockId="adaptive-test-a"
        >
          <div>main</div>
        </ListPageLayout>,
      );
      expect(container.querySelector('.alm-listpage__detail')).not.toHaveClass(
        'alm-listpage__detail--side',
      );

      resizeWindowTo(1600);
      rerender(
        <ListPageLayout
          topBar={<div>bar</div>}
          detail={<div>detail</div>}
          dockId="adaptive-test-a"
        >
          <div>main</div>
        </ListPageLayout>,
      );
      expect(container.querySelector('.alm-listpage__detail')).toHaveClass(
        'alm-listpage__detail--side',
      );
    });

    it('honors adaptiveThreshold overrides per page', () => {
      resizeWindowTo(1450);
      const { container } = render(
        <ListPageLayout
          topBar={<div>bar</div>}
          detail={<div>detail</div>}
          dockId="adaptive-test-threshold"
          adaptiveThreshold={1500}
        >
          <div>main</div>
        </ListPageLayout>,
      );
      // 1450 < 1500 → still bottom, even though it clears the generic default.
      expect(container.querySelector('.alm-listpage__detail')).not.toHaveClass(
        'alm-listpage__detail--side',
      );
    });

    it('pinning to side persists across remount (dockId-scoped localStorage)', () => {
      resizeWindowTo(1024);
      const { container, unmount } = render(
        <ListPageLayout
          topBar={<div>bar</div>}
          detail={<div>detail</div>}
          dockId="adaptive-test-pin"
        >
          <div>main</div>
        </ListPageLayout>,
      );
      fireEvent.click(screen.getByTestId('dock-placement-toggle'));
      expect(container.querySelector('.alm-listpage__detail')).toHaveClass(
        'alm-listpage__detail--side',
      );
      unmount();

      const { container: container2 } = render(
        <ListPageLayout
          topBar={<div>bar</div>}
          detail={<div>detail</div>}
          dockId="adaptive-test-pin"
        >
          <div>main</div>
        </ListPageLayout>,
      );
      // Narrow window (1024), but the pin from the previous mount survives.
      expect(container2.querySelector('.alm-listpage__detail')).toHaveClass(
        'alm-listpage__detail--side',
      );
    });

    it('renders a resize handle only in the side placement', () => {
      resizeWindowTo(1600);
      const { rerender, queryByTestId } = render(
        <ListPageLayout
          topBar={<div>bar</div>}
          detail={<div>detail</div>}
          dockId="adaptive-test-handle"
        >
          <div>main</div>
        </ListPageLayout>,
      );
      expect(queryByTestId('dock-resize-handle')).toBeInTheDocument();

      resizeWindowTo(1024);
      rerender(
        <ListPageLayout
          topBar={<div>bar</div>}
          detail={<div>detail</div>}
          dockId="adaptive-test-handle"
        >
          <div>main</div>
        </ListPageLayout>,
      );
      expect(queryByTestId('dock-resize-handle')).not.toBeInTheDocument();
    });

    it('keeps role=complementary + close affordance working in adaptive-side mode', () => {
      resizeWindowTo(1600);
      const onClose = vi.fn();
      render(
        <ListPageLayout
          topBar={<div>bar</div>}
          detail={<div>detail</div>}
          dockId="adaptive-test-close"
          detailLabel="Adaptive details"
          onCloseDetail={onClose}
        >
          <div>main</div>
        </ListPageLayout>,
      );
      const region = screen.getByRole('complementary', {
        name: 'Adaptive details',
      });
      expect(region).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
