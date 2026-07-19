// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Vitest unit tests for SourceProtectionOverride (spec 016 US2, T015; issue
 * #562 controlled-open rewrite).
 *
 * `open`/`onOpenChange` are now controlled by the caller (DataSources' kebab
 * "Edit protection…" item) — the component itself renders only the compact
 * pill plus, when `open`, the level-select editor. Uses a thin wrapper to
 * hold the open state the real caller would own.
 */

import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SourceProtectionOverride } from './SourceProtectionOverride';
import type {
  SourceProtectionGetResponse,
  ProtectionLevel,
} from './settingsIpc';

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

/** Wraps the controlled component with the open-state the caller would own. */
function ControlledHarness({
  initialOpen = false,
  onSaved,
}: {
  initialOpen?: boolean;
  onSaved?: (level: ProtectionLevel) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Edit protection…
      </button>
      <SourceProtectionOverride
        sourceId="src-1"
        open={open}
        onOpenChange={setOpen}
        onSaved={onSaved}
      />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SourceProtectionOverride', () => {
  it('shows loading state initially', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    render(
      <SourceProtectionOverride
        sourceId="src-1"
        open={false}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText(/Loading/i)).toBeTruthy();
  });

  it('shows just the compact protection pill when not open (issue #562 declutter)', async () => {
    mockGet.mockResolvedValue({
      status: 'ok',
      data: makeGetResponse({ inheritsDefault: true, level: 'protected' }),
    });
    render(
      <SourceProtectionOverride
        sourceId="src-1"
        open={false}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Protected')).toBeTruthy();
    });
    // No separate "Inherits global default" pill/sentence, no Override
    // trigger button — the caller drives editing via the kebab menu instead.
    expect(screen.queryByText('Inherits global default')).toBeNull();
    expect(screen.queryByRole('button', { name: /Override/i })).toBeNull();
  });

  it('shows the override pill for a non-default level when not open', async () => {
    mockGet.mockResolvedValue({
      status: 'ok',
      data: makeGetResponse({ inheritsDefault: false, level: 'unprotected' }),
    });
    render(
      <SourceProtectionOverride
        sourceId="src-1"
        open={false}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Unprotected')).toBeTruthy();
    });
  });

  it('renders the editor when open is true', async () => {
    mockGet.mockResolvedValue({ status: 'ok', data: makeGetResponse() });
    render(<ControlledHarness initialOpen />);

    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: /Protection level override/i }),
      ).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: /Save override/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeTruthy();
  });

  it('opens the editor when the caller flips open to true', async () => {
    mockGet.mockResolvedValue({ status: 'ok', data: makeGetResponse() });
    render(<ControlledHarness />);

    expect(
      screen.queryByRole('combobox', { name: /Protection level override/i }),
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Edit protection/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('combobox', { name: /Protection level override/i }),
      ).toBeTruthy();
    });
  });

  it('saves override, updates the pill, and closes via onOpenChange', async () => {
    mockGet.mockResolvedValue({
      status: 'ok',
      data: makeGetResponse({ level: 'protected', inheritsDefault: true }),
    });
    mockSet.mockResolvedValue({
      status: 'ok',
      data: {
        sourceId: 'src-1',
        priorLevel: 'protected',
        newLevel: 'unprotected',
        priorBlockPermanentDelete: null,
        newBlockPermanentDelete: null,
        priorCategories: null,
        newCategories: null,
        auditId: 'audit-1',
      },
    });

    const onSaved = vi.fn();
    render(<ControlledHarness initialOpen onSaved={onSaved} />);

    const select = await screen.findByRole('combobox', {
      name: /Protection level override/i,
    });
    fireEvent.change(select, { target: { value: 'unprotected' } });

    fireEvent.click(screen.getByRole('button', { name: /Save override/i }));

    await waitFor(() => {
      expect(screen.getByText('Unprotected')).toBeTruthy();
    });
    expect(mockSet).toHaveBeenCalledWith({
      sourceId: 'src-1',
      level: 'unprotected',
    });
    expect(onSaved).toHaveBeenCalledWith('unprotected');
    // Closed after save — editor no longer rendered.
    expect(screen.queryByRole('button', { name: /Save override/i })).toBeNull();
  });

  it('shows error on load failure', async () => {
    mockGet.mockRejectedValue('network error');
    render(
      <SourceProtectionOverride
        sourceId="src-1"
        open={false}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Could not load protection/i)).toBeTruthy();
    });
  });

  it('shows level hint as a pill tooltip (title) for the protected level', async () => {
    mockGet.mockResolvedValue({
      status: 'ok',
      data: makeGetResponse({ level: 'protected', inheritsDefault: false }),
    });
    render(
      <SourceProtectionOverride
        sourceId="src-1"
        open={false}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Protected').getAttribute('title')).toMatch(
        /Cleanup plans require explicit approval/i,
      );
    });
  });

  it('can cancel edit without saving, closing via onOpenChange', async () => {
    mockGet.mockResolvedValue({
      status: 'ok',
      data: makeGetResponse({ level: 'protected', inheritsDefault: true }),
    });
    render(<ControlledHarness initialOpen />);

    const select = await screen.findByRole('combobox', {
      name: /Protection level override/i,
    });
    fireEvent.change(select, { target: { value: 'unprotected' } });

    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    // Should return to display mode showing original Protected level.
    await waitFor(() => {
      expect(screen.getByText('Protected')).toBeTruthy();
    });
    expect(mockSet).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Save override/i })).toBeNull();
  });
});
