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

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ListPageLayout } from './ListPageLayout';

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
});
