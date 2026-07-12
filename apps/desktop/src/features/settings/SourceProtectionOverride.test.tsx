/**
 * Vitest unit tests for SourceProtectionOverride (spec 016 US2, T015).
 *
 * Tests per-source protection badge, inheritance display, and override flow
 * using mock invoke. Does NOT run against a real backend.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SourceProtectionOverride } from './SourceProtectionOverride';
import type { SourceProtectionGetResponse } from './settingsIpc';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Mocks the generated bindings surface (spec 037) so the real `settingsIpc`
// wrappers (sourceProtectionGet/Set) run and unwrap the Result envelope.

const { mockGet, mockSet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    sourceProtectionGet: mockGet,
    sourceProtectionSet: mockSet,
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGetResponse(
  overrides: Partial<SourceProtectionGetResponse> = {},
): SourceProtectionGetResponse {
  return {
    sourceId: 'src-1',
    level: 'protected',
    blockPermanentDelete: true,
    categories: ['lights', 'masters', 'finals'],
    inheritsDefault: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SourceProtectionOverride', () => {
  it('shows loading state initially', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    render(<SourceProtectionOverride sourceId="src-1" />);
    expect(screen.getByText(/Loading/i)).toBeTruthy();
  });

  it('shows Protected pill and Inherits global default badge when inheriting', async () => {
    mockGet.mockResolvedValue({
      status: 'ok',
      data: makeGetResponse({ inheritsDefault: true, level: 'protected' }),
    });
    render(<SourceProtectionOverride sourceId="src-1" />);

    await waitFor(() => {
      expect(screen.getByText('Protected')).toBeTruthy();
      expect(screen.getByText('Inherits global default')).toBeTruthy();
    });
  });

  it('shows override pill without inherits badge when override is set', async () => {
    mockGet.mockResolvedValue({
      status: 'ok',
      data: makeGetResponse({ inheritsDefault: false, level: 'normal' }),
    });
    render(<SourceProtectionOverride sourceId="src-1" />);

    await waitFor(() => {
      expect(screen.getByText('Normal')).toBeTruthy();
    });
    // Should not show the inherits badge.
    expect(screen.queryByText('Inherits global default')).toBeNull();
  });

  it('shows Override button', async () => {
    mockGet.mockResolvedValue({ status: 'ok', data: makeGetResponse() });
    render(<SourceProtectionOverride sourceId="src-1" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Override/i })).toBeTruthy();
    });
  });

  it('opens editing mode on Override click', async () => {
    mockGet.mockResolvedValue({ status: 'ok', data: makeGetResponse() });
    render(<SourceProtectionOverride sourceId="src-1" />);

    await waitFor(() => screen.getByRole('button', { name: /Override/i }));
    fireEvent.click(screen.getByRole('button', { name: /Override/i }));

    expect(
      screen.getByRole('combobox', { name: /Protection level override/i }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Save override/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeTruthy();
  });

  it('saves override and updates level display', async () => {
    mockGet.mockResolvedValue({
      status: 'ok',
      data: makeGetResponse({ level: 'protected', inheritsDefault: true }),
    });
    mockSet.mockResolvedValue({
      status: 'ok',
      data: {
        sourceId: 'src-1',
        priorLevel: 'protected',
        newLevel: 'normal',
        priorBlockPermanentDelete: null,
        newBlockPermanentDelete: null,
        priorCategories: null,
        newCategories: null,
        auditId: 'audit-1',
      },
    });

    const onSaved = vi.fn();
    render(<SourceProtectionOverride sourceId="src-1" onSaved={onSaved} />);

    await waitFor(() => screen.getByRole('button', { name: /Override/i }));
    fireEvent.click(screen.getByRole('button', { name: /Override/i }));

    // Change the select to "normal".
    const select = screen.getByRole('combobox', {
      name: /Protection level override/i,
    });
    fireEvent.change(select, { target: { value: 'normal' } });

    fireEvent.click(screen.getByRole('button', { name: /Save override/i }));

    await waitFor(() => {
      expect(screen.getByText('Normal')).toBeTruthy();
    });
    expect(mockSet).toHaveBeenCalledWith({
      sourceId: 'src-1',
      level: 'normal',
    });
    expect(onSaved).toHaveBeenCalledWith('normal');
    // After save, should not be in edit mode anymore.
    expect(screen.queryByRole('button', { name: /Save override/i })).toBeNull();
  });

  it('shows error on load failure', async () => {
    mockGet.mockRejectedValue('network error');
    render(<SourceProtectionOverride sourceId="src-1" />);

    await waitFor(() => {
      expect(screen.getByText(/Could not load protection/i)).toBeTruthy();
    });
  });

  it('shows level hint text for protected level', async () => {
    mockGet.mockResolvedValue({
      status: 'ok',
      data: makeGetResponse({ level: 'protected', inheritsDefault: false }),
    });
    render(<SourceProtectionOverride sourceId="src-1" />);

    await waitFor(() => {
      expect(
        screen.getByText(/Cleanup plans require explicit approval/i),
      ).toBeTruthy();
    });
  });

  it('can cancel edit without saving', async () => {
    mockGet.mockResolvedValue({
      status: 'ok',
      data: makeGetResponse({ level: 'protected', inheritsDefault: true }),
    });
    render(<SourceProtectionOverride sourceId="src-1" />);

    await waitFor(() => screen.getByRole('button', { name: /Override/i }));
    fireEvent.click(screen.getByRole('button', { name: /Override/i }));

    const select = screen.getByRole('combobox', {
      name: /Protection level override/i,
    });
    fireEvent.change(select, { target: { value: 'unprotected' } });

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    // Should return to display mode showing original Protected level.
    await waitFor(() => {
      expect(screen.getByText('Protected')).toBeTruthy();
    });
    expect(mockSet).not.toHaveBeenCalled();
  });
});
