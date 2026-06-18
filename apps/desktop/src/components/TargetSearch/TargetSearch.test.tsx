/// <reference types="@testing-library/jest-dom" />
/**
 * TargetSearch tests — spec 035 US1 (task T013).
 *
 * Covers:
 *   1. Debounced query triggers `target.search` with the typed query + limit.
 *   2. Suggestions render primary designation, secondary name, and type/source badges.
 *   3. commonName falls back to matchedAlias and is omitted gracefully when absent.
 *   4. Clicking a suggestion fires onSelect with the canonical targetId.
 *   5. Keyboard navigation (ArrowDown + Enter) selects a suggestion.
 *   6. A failed command surfaces an inline error.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSearchTargets } = vi.hoisted(() => ({ mockSearchTargets: vi.fn() }));

vi.mock('@/api/commands', () => ({
  searchTargets: mockSearchTargets,
  TARGET_SEARCH_CONTRACT_VERSION: '1.0',
}));

import { TargetSearch } from './TargetSearch';
import type { TargetSuggestion } from '@/api/commands';

const M31: TargetSuggestion = {
  targetId: 'tgt-m31',
  primaryDesignation: 'M 31',
  commonName: 'Andromeda Galaxy',
  objectType: 'galaxy',
  matchedAlias: 'Andromeda',
  source: 'seed',
};

const NGC7000: TargetSuggestion = {
  targetId: 'tgt-ngc7000',
  primaryDesignation: 'NGC 7000',
  commonName: null,
  objectType: 'emission_nebula',
  matchedAlias: 'North America Nebula',
  source: 'resolved',
};

const NO_SECONDARY: TargetSuggestion = {
  targetId: 'tgt-x',
  primaryDesignation: 'IC 1396',
  commonName: null,
  objectType: 'open_cluster',
  matchedAlias: null,
  source: 'resolved',
};

beforeEach(() => {
  vi.useFakeTimers();
  mockSearchTargets.mockReset();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

async function typeAndFlush(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  // advance past the 300ms debounce + flush the awaited promise
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('TargetSearch', () => {
  it('debounces and calls target.search with the query + limit', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    render(<TargetSearch onSelect={vi.fn()} limit={20} />);
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'andr' } });
    expect(mockSearchTargets).not.toHaveBeenCalled(); // debounced

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(mockSearchTargets).toHaveBeenCalledTimes(1);
    expect(mockSearchTargets).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'andr', limit: 20, contractVersion: '1.0' }),
    );
  });

  it('renders designation, common name, and type/source badges', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'm31');

    const option = screen.getByRole('option');
    expect(option).toHaveTextContent('M 31');
    expect(option).toHaveTextContent('Andromeda Galaxy');
    expect(option).toHaveTextContent('Galaxy');
    expect(option).toHaveTextContent('seed');
  });

  it('falls back to matchedAlias when commonName is absent', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [NGC7000],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'na');

    const option = screen.getByRole('option');
    expect(option).toHaveTextContent('NGC 7000');
    expect(option).toHaveTextContent('North America Nebula');
  });

  it('renders without a secondary line when no name/alias exists', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [NO_SECONDARY],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'ic');

    const option = screen.getByRole('option');
    expect(option).toHaveTextContent('IC 1396');
    expect(option.querySelector('.alm-target-search__secondary')).toBeNull();
  });

  it('calls onSelect with the suggestion (targetId) on click', async () => {
    const onSelect = vi.fn();
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31, NGC7000],
    });
    render(<TargetSearch onSelect={onSelect} />);
    await typeAndFlush(screen.getByRole('combobox'), 'm');

    const options = screen.getAllByRole('option');
    fireEvent.mouseDown(options[1]);
    expect(onSelect).toHaveBeenCalledWith(NGC7000);
    const selected = onSelect.mock.calls[0][0] as TargetSuggestion;
    expect(selected.targetId).toBe('tgt-ngc7000');
  });

  it('supports keyboard navigation (ArrowDown + Enter)', async () => {
    const onSelect = vi.fn();
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31, NGC7000],
    });
    render(<TargetSearch onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    await typeAndFlush(input, 'm');

    screen.getAllByRole('option');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // active 0 -> 1
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(NGC7000);
  });

  it('surfaces an inline error when the command rejects', async () => {
    mockSearchTargets.mockRejectedValue('db.error');
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'm31');

    expect(screen.getByRole('alert')).toHaveTextContent('db.error');
  });
});
