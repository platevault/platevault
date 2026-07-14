// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * AddTargetDialog tests — G fix ("Add target" opens SIMBAD resolve flow).
 *
 * Tests:
 *  1. Dialog is hidden by default.
 *  2. Selecting a suggestion shows the "selected target" confirmation view.
 *  3. "Add target" button calls target.adopt with the suggestion's targetId.
 *  4. On adopted=true, onAdded is called with the target id and dialog closes.
 *  5. On adopted=false, an inline error is shown and onAdded is NOT called.
 *  6. On target.adopt rejection, an error message renders.
 *  7. "Change" resets back to the search view.
 *  8. Confirm button is disabled when no suggestion is pending.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSearchTargets, mockAdoptTarget } = vi.hoisted(() => ({
  mockSearchTargets: vi.fn(),
  mockAdoptTarget: vi.fn(),
}));

/** Wrap a value in the generated `{ status: 'ok' }` Result envelope. */
const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

// AddTargetDialog and its TargetSearch child both call the generated bindings
// (spec 037/052): TargetSearch -> commands.targetSearch, AddTargetDialog ->
// commands.targetAdopt (spec 052 P1: confirm is the in-use commit — target.
// search/target.resolve no longer persist on their own). The real unwrap
// runs against these Result envelopes.
vi.mock('@/bindings/index', () => ({
  commands: {
    targetSearch: mockSearchTargets,
    targetAdopt: mockAdoptTarget,
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no tauri in tests')),
}));

import { AddTargetDialog } from './AddTargetDialog';
import type { TargetSuggestion } from '@/bindings/aliases';

const M31: TargetSuggestion = {
  targetId: 'tgt-m31',
  primaryDesignation: 'M 31',
  commonName: 'Andromeda Galaxy',
  objectType: 'galaxy',
  matchedAlias: 'Andromeda',
  source: 'seed',
};

function adopted(targetId: string) {
  return { targetId, adopted: true };
}

function notAdopted(targetId: string) {
  return { targetId, adopted: false };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: search returns M31
  mockSearchTargets.mockResolvedValue(
    ok({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    }),
  );
  mockAdoptTarget.mockResolvedValue(ok(adopted('tgt-m31')));
});

describe('AddTargetDialog', () => {
  it('1. dialog is hidden when open=false', () => {
    render(
      <AddTargetDialog open={false} onClose={vi.fn()} onAdded={vi.fn()} />,
    );
    // Dialog.Popup not in the DOM when closed
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('2. selecting a suggestion shows the confirmation view', async () => {
    render(<AddTargetDialog open onClose={vi.fn()} onAdded={vi.fn()} />);

    // Type in search box to trigger suggestions
    const input = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'M 31' } });
    });

    // Wait for the suggestion to appear
    await waitFor(() => {
      expect(screen.getByText('M 31')).toBeInTheDocument();
    });

    // Click the suggestion (base-ui Combobox selects on click).
    const option = screen.getByRole('option', { name: /M 31/i });
    fireEvent.click(option);

    // Confirmation view should show selected target pill
    await waitFor(() => {
      expect(screen.getByText('Selected target')).toBeInTheDocument();
      expect(screen.getByText('Change')).toBeInTheDocument();
    });
  });

  it('3. confirm calls target.adopt with the selected targetId', async () => {
    const onAdded = vi.fn();
    render(<AddTargetDialog open onClose={vi.fn()} onAdded={onAdded} />);

    const input = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'M 31' } });
    });

    await waitFor(() => screen.getByRole('option', { name: /M 31/i }));
    // base-ui Combobox selects an option on click (was a hand-rolled mousedown).
    fireEvent.click(screen.getByRole('option', { name: /M 31/i }));

    await waitFor(() => screen.getByText('Change'));

    const confirmBtn = screen.getByRole('button', { name: /Add target/i });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => {
      expect(mockAdoptTarget).toHaveBeenCalledWith(
        expect.objectContaining({ targetId: 'tgt-m31' }),
      );
    });
  });

  it('4. adopted=true calls onAdded with the target id', async () => {
    const onAdded = vi.fn();
    const onClose = vi.fn();
    mockAdoptTarget.mockResolvedValue(ok(adopted('tgt-m31')));

    render(<AddTargetDialog open onClose={onClose} onAdded={onAdded} />);

    const input = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'M 31' } });
    });
    await waitFor(() => screen.getByRole('option', { name: /M 31/i }));
    // base-ui Combobox selects an option on click (was a hand-rolled mousedown).
    fireEvent.click(screen.getByRole('option', { name: /M 31/i }));
    await waitFor(() => screen.getByText('Change'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add target/i }));
    });

    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledWith('tgt-m31');
    });
  });

  it('5. adopted=false shows error and does not call onAdded', async () => {
    const onAdded = vi.fn();
    mockAdoptTarget.mockResolvedValue(ok(notAdopted('tgt-m31')));

    render(<AddTargetDialog open onClose={vi.fn()} onAdded={onAdded} />);

    const input = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'M 31' } });
    });
    await waitFor(() => screen.getByRole('option', { name: /M 31/i }));
    // base-ui Combobox selects an option on click (was a hand-rolled mousedown).
    fireEvent.click(screen.getByRole('option', { name: /M 31/i }));
    await waitFor(() => screen.getByText('Change'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add target/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('6. target.adopt rejection shows an error message', async () => {
    const onAdded = vi.fn();
    mockAdoptTarget.mockRejectedValue(new Error('network_error'));

    render(<AddTargetDialog open onClose={vi.fn()} onAdded={onAdded} />);

    const input = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'M 31' } });
    });
    await waitFor(() => screen.getByRole('option', { name: /M 31/i }));
    // base-ui Combobox selects an option on click (was a hand-rolled mousedown).
    fireEvent.click(screen.getByRole('option', { name: /M 31/i }));
    await waitFor(() => screen.getByText('Change'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Add target/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('7. Change button resets back to search view', async () => {
    render(<AddTargetDialog open onClose={vi.fn()} onAdded={vi.fn()} />);

    const input = screen.getByRole('combobox');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'M 31' } });
    });
    await waitFor(() => screen.getByRole('option', { name: /M 31/i }));
    // base-ui Combobox selects an option on click (was a hand-rolled mousedown).
    fireEvent.click(screen.getByRole('option', { name: /M 31/i }));
    await waitFor(() => screen.getByText('Change'));

    fireEvent.click(screen.getByText('Change'));

    // Should return to search view
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });
    expect(screen.queryByText('Selected target')).not.toBeInTheDocument();
  });

  it('8. confirm button is disabled when no suggestion is pending', () => {
    render(<AddTargetDialog open onClose={vi.fn()} onAdded={vi.fn()} />);
    // No suggestion selected — confirm button should be disabled
    const confirmBtn = screen.getByRole('button', { name: /Add target/i });
    expect(confirmBtn).toBeDisabled();
  });
});
