// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * DirPicker tests (#662) — the shared path-entry affordance used by
 * RemapRootDialog and DataSources' add-source form.
 *
 * Verifies manual entry (typing/pasting a path) fires onChange the same way
 * the native picker does, alongside the existing "Choose folder" behaviour.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DirPicker } from './DirPicker';

const { mockPick } = vi.hoisted(() => ({ mockPick: vi.fn() }));

vi.mock('@/shared/native/picker', () => ({
  useDirectoryPicker: () => ({
    pick: mockPick,
    loading: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

describe('DirPicker', () => {
  it('renders a manual-entry input alongside the native picker button', () => {
    render(<DirPicker value="" onChange={vi.fn()} label="Folder" />);
    expect(screen.getByLabelText('Folder')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Choose folder/i }),
    ).toBeInTheDocument();
  });

  it('fires onChange when the user types a path', () => {
    const onChange = vi.fn();
    render(<DirPicker value="" onChange={onChange} label="Folder" />);

    fireEvent.change(screen.getByLabelText('Folder'), {
      target: { value: '/astro/lights' },
    });

    expect(onChange).toHaveBeenCalledWith('/astro/lights');
  });

  it('fires onChange when the native picker returns a path', async () => {
    const onChange = vi.fn();
    mockPick.mockResolvedValueOnce({ path: '/astro/picked' });
    render(<DirPicker value="" onChange={onChange} label="Folder" />);

    fireEvent.click(screen.getByRole('button', { name: /Choose folder/i }));

    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith('/astro/picked'),
    );
  });

  it('reflects the current value in the manual-entry input', () => {
    render(
      <DirPicker value="/astro/existing" onChange={vi.fn()} label="Folder" />,
    );
    expect(screen.getByDisplayValue('/astro/existing')).toBeInTheDocument();
  });
});
