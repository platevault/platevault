// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ListPageLayout tests — spec 043 task #94; spec 054 T005/T009.
 *
 * Covers the STATIC `detailPlacement` prop (used when `dockPage` is omitted):
 * the DEFAULT `'bottom'` dock keeps the existing classes (Sessions/
 * Calibration/Targets are unchanged), while `'side'` switches the body +
 * detail to the right-side-panel variant classes. Both keep
 * role=complementary, the detailLabel, and the close ✕ affordance.
 *
 * The dead `detailPlacement="side-and-bottom"` dual variant (spec 043 task
 * #104) was deleted in spec 054 T009 — no page ever adopted it. Adaptive
 * placement coverage (mocked `useDetailDock` → side/bottom/split) lives in
 * `ListPageLayout.dock.test.tsx`.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ListPageLayout } from './ListPageLayout';
import { Modal } from './Modal';
import { Combobox } from '@base-ui-components/react/combobox';

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
});
