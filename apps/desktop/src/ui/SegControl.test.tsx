// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SegControl a11y tests (#1010): radiogroup semantics, roving tabindex, and
 * arrow-key navigation per the WAI-ARIA radio-group pattern.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { SegControl, type SegControlOption } from './SegControl';

const OPTIONS: SegControlOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function Harness({ initial = 'a' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <SegControl
      options={OPTIONS}
      value={value}
      onChange={setValue}
      aria-label="Test control"
    />
  );
}

describe('SegControl a11y (#1010)', () => {
  it('renders a labelled radiogroup with radio options', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Test control' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('marks only the active option as aria-checked', () => {
    render(<Harness initial="b" />);
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('uses roving tabindex: only the active option is tabbable', () => {
    render(<Harness initial="b" />);
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute(
      'tabIndex',
      '-1',
    );
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute(
      'tabIndex',
      '0',
    );
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveAttribute(
      'tabIndex',
      '-1',
    );
  });

  it('ArrowRight/ArrowDown selects the next option, wrapping at the end', () => {
    render(<Harness initial="c" />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Gamma' }), {
      key: 'ArrowRight',
    });
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('ArrowLeft/ArrowUp selects the previous option, wrapping at the start', () => {
    render(<Harness initial="a" />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Alpha' }), {
      key: 'ArrowLeft',
    });
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('click still selects an option directly', () => {
    const onChange = vi.fn();
    render(
      <SegControl
        options={OPTIONS}
        value="a"
        onChange={onChange}
        aria-label="Test control"
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('applies alm-seg__btn--active to the selected option only (CI-red regression guard)', () => {
    // The role="radio" migration broke consumer e2e locators that queried
    // by role="button" (getByRole('radio', ...) is the correct query now),
    // but the visual active-class contract itself must be unaffected —
    // every consumer (Cleanup keep/archive/trash, TargetList density,
    // future dock-placement control) still styles the selected option via
    // this class, not the ARIA role.
    render(<Harness initial="b" />);
    expect(screen.getByRole('radio', { name: 'Alpha' })).not.toHaveClass(
      'alm-seg__btn--active',
    );
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveClass(
      'alm-seg__btn--active',
    );
    expect(screen.getByRole('radio', { name: 'Gamma' })).not.toHaveClass(
      'alm-seg__btn--active',
    );
  });
});
