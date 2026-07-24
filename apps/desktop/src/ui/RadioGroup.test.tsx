// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * RadioGroup a11y tests (#1464-followup): radiogroup/radio semantics, aria-checked,
 * and arrow-key roving-tabindex per the WAI-ARIA radio-group pattern.
 * Rebuilding on @base-ui-components/react radio-group fixes the prior
 * plain-<button> implementation that lacked role, aria-checked, and roving focus.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { RadioGroup, type RadioOption } from './RadioGroup';

const OPTIONS: RadioOption[] = [
  { value: 'archive', label: 'Archive' },
  { value: 'trash', label: 'Trash' },
  { value: 'delete', label: 'Delete' },
];

function Harness({ initial = 'archive' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <RadioGroup
      options={OPTIONS}
      value={value}
      onChange={setValue}
      aria-label="Destination"
    />
  );
}

describe('RadioGroup a11y', () => {
  it('renders a labelled radiogroup with radio items', () => {
    render(<Harness />);
    const group = screen.getByRole('radiogroup', { name: 'Destination' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('marks only the selected item as aria-checked=true', () => {
    render(<Harness initial="trash" />);
    expect(screen.getByRole('radio', { name: 'Archive' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByRole('radio', { name: 'Trash' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Delete' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('uses roving tabindex: only the selected item is tabbable', () => {
    render(<Harness initial="trash" />);
    expect(screen.getByRole('radio', { name: 'Archive' })).toHaveAttribute(
      'tabIndex',
      '-1',
    );
    expect(screen.getByRole('radio', { name: 'Trash' })).toHaveAttribute(
      'tabIndex',
      '0',
    );
    expect(screen.getByRole('radio', { name: 'Delete' })).toHaveAttribute(
      'tabIndex',
      '-1',
    );
  });

  it('calls onChange when a radio item is clicked', () => {
    const onChange = vi.fn();
    render(
      <RadioGroup
        options={OPTIONS}
        value="archive"
        onChange={onChange}
        aria-label="Destination"
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Trash' }));
    expect(onChange).toHaveBeenCalledWith('trash');
  });

  it('ArrowDown selects the next item, wrapping at the end', async () => {
    render(<Harness initial="delete" />);
    const item = screen.getByRole('radio', { name: 'Delete' });
    await act(async () => {
      item.focus();
      fireEvent.keyDown(item, { key: 'ArrowDown' });
    });
    expect(screen.getByRole('radio', { name: 'Archive' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('ArrowUp selects the previous item, wrapping at the start', async () => {
    render(<Harness initial="archive" />);
    const item = screen.getByRole('radio', { name: 'Archive' });
    await act(async () => {
      item.focus();
      fireEvent.keyDown(item, { key: 'ArrowUp' });
    });
    expect(screen.getByRole('radio', { name: 'Delete' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('renders the desc text for RadioOption objects', () => {
    render(
      <RadioGroup
        options={[{ value: 'x', label: 'X', desc: 'Hint text' }]}
        value="x"
        onChange={vi.fn()}
        aria-label="Test"
      />,
    );
    expect(screen.getByText('Hint text')).toBeInTheDocument();
  });

  it('passes testId to data-testid on the radio item', () => {
    render(
      <RadioGroup
        options={[{ value: 'x', label: 'X', testId: 'my-option' }]}
        value="x"
        onChange={vi.fn()}
        aria-label="Test"
      />,
    );
    expect(screen.getByTestId('my-option')).toBeInTheDocument();
  });

  it('accepts plain string options', () => {
    render(
      <RadioGroup
        options={['alpha', 'beta']}
        value="alpha"
        onChange={vi.fn()}
        aria-label="Test"
      />,
    );
    expect(screen.getByRole('radio', { name: 'alpha' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'beta' })).toBeInTheDocument();
  });

  it('does not carry a type=submit hazard (no native button rendered)', () => {
    render(<Harness />);
    // No <button> elements — base-ui Radio.Root renders a <span>
    const buttons = document.querySelectorAll(
      'button[type="submit"], button:not([type])',
    );
    expect(buttons.length).toBe(0);
  });
});
