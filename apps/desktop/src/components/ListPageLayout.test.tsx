/// <reference types="@testing-library/jest-dom" />
/**
 * ListPageLayout tests — spec 043 task #94.
 *
 * Covers the `detailPlacement` prop: the DEFAULT `'bottom'` dock keeps the
 * existing classes (Sessions/Calibration/Targets are unchanged), while `'side'`
 * switches the body + detail to the right-side-panel variant classes. Both keep
 * role=complementary, the detailLabel, and the close ✕ affordance.
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
    const region = screen.getByRole('complementary', { name: 'Project details' });
    expect(region).toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Close details' });
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
