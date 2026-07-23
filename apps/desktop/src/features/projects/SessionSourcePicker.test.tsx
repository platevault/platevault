// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * SessionSourcePicker tests — WP-008-C extraction.
 *
 * The shared session-list-with-selection pattern (originally the wizard's
 * StepSources) now lives here so it can be embedded both by the wizard and by
 * EditProjectPane's post-creation "add sources" flow. Covers:
 * 1. Renders fetched sessions and reports selection changes.
 * 2. Target/filter free-text filters narrow the visible rows.
 * 3. `excludeSessionIds` hides already-linked sessions from the list.
 * 4. Empty state after exclusion shows the `emptyMessage` override.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { mockSessionsList } = vi.hoisted(() => ({
  mockSessionsList: vi.fn(),
}));

vi.mock('@/bindings/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/bindings/index')>();
  return {
    ...original,
    commands: {
      ...original.commands,
      sessionsList: mockSessionsList,
    },
  };
});

import {
  SessionSourcePicker,
  type SessionSourcePickerProps,
} from './SessionSourcePicker';
import type { AcquisitionSession_Serialize } from '@/bindings/index';

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function session(
  overrides: Partial<AcquisitionSession_Serialize> = {},
): AcquisitionSession_Serialize {
  return {
    id: 'sess-001',
    sessionKey: {
      target: 'M31',
      filter: 'Ha',
      binning: '1',
      gain: '100',
      night: '2026-06-01',
    },
    confidence: 'confirmed',
    opticalTrainId: 'train-00000001',
    frameCount: 12,
    totalIntegrationSeconds: 3600,
    totalSizeBytes: 0,
    metadata: {},
    targetIds: [],
    projectIds: [],
    warnings: [],
    ...overrides,
  };
}

function renderPicker(props: Partial<SessionSourcePickerProps> = {}) {
  const onChange = props.onChange ?? vi.fn();
  render(
    <SessionSourcePicker
      selectedSessionIds={props.selectedSessionIds ?? []}
      onChange={onChange}
      excludeSessionIds={props.excludeSessionIds}
      emptyMessage={props.emptyMessage}
    />,
    { wrapper },
  );
  return { onChange };
}

describe('SessionSourcePicker', () => {
  it('renders fetched sessions and reports selection on checkbox click', async () => {
    mockSessionsList.mockResolvedValue({
      status: 'ok',
      data: [
        session({
          id: 'sess-001',
          sessionKey: {
            target: 'M31',
            filter: 'Ha',
            binning: '1',
            gain: '100',
            night: '2026-06-01',
          },
        }),
      ],
    });
    const { onChange } = renderPicker();

    await waitFor(() => {
      expect(screen.getByText(/M31 \/ Ha \/ 2026-06-01/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /M31 session/i }));
    expect(onChange).toHaveBeenCalledWith(['sess-001']);
  });

  it('filters the list by target free text', async () => {
    mockSessionsList.mockResolvedValue({
      status: 'ok',
      data: [
        session({
          id: 'sess-m31',
          sessionKey: {
            target: 'M31',
            filter: 'Ha',
            binning: '1',
            gain: '100',
            night: '2026-06-01',
          },
        }),
        session({
          id: 'sess-ngc',
          sessionKey: {
            target: 'NGC 7000',
            filter: 'OIII',
            binning: '1',
            gain: '100',
            night: '2026-06-02',
          },
        }),
      ],
    });
    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(/M31 \/ Ha/)).toBeInTheDocument();
      expect(screen.getByText(/NGC 7000 \/ OIII/)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText(/Filter by target/i), {
      target: { value: 'ngc' },
    });

    expect(screen.queryByText(/M31 \/ Ha/)).not.toBeInTheDocument();
    expect(screen.getByText(/NGC 7000 \/ OIII/)).toBeInTheDocument();
  });

  it('hides sessions in excludeSessionIds (already-linked sources)', async () => {
    mockSessionsList.mockResolvedValue({
      status: 'ok',
      data: [
        session({
          id: 'sess-linked',
          sessionKey: {
            target: 'M31',
            filter: 'Ha',
            binning: '1',
            gain: '100',
            night: '2026-06-01',
          },
        }),
        session({
          id: 'sess-unlinked',
          sessionKey: {
            target: 'NGC 7000',
            filter: 'OIII',
            binning: '1',
            gain: '100',
            night: '2026-06-02',
          },
        }),
      ],
    });
    renderPicker({ excludeSessionIds: ['sess-linked'] });

    await waitFor(() => {
      expect(screen.getByText(/NGC 7000 \/ OIII/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/M31 \/ Ha/)).not.toBeInTheDocument();
  });

  it('shows the emptyMessage override when every session is excluded', async () => {
    mockSessionsList.mockResolvedValue({
      status: 'ok',
      data: [session({ id: 'sess-001' })],
    });
    renderPicker({
      excludeSessionIds: ['sess-001'],
      emptyMessage: 'All sessions are already linked to this project.',
    });

    await waitFor(() => {
      expect(
        screen.getByText('All sessions are already linked to this project.'),
      ).toBeInTheDocument();
    });
  });

  it('renders a fallback instead of crashing when sessionKey.target is undefined', async () => {
    mockSessionsList.mockResolvedValue({
      status: 'ok',
      data: [
        session({
          id: 'sess-unresolved',
          // The contract types `target` as `string`, but a session whose
          // target never resolved can still reach the UI with it missing —
          // exercise that runtime shape directly, not just the type.
          sessionKey: {
            target: undefined as unknown as string,
            filter: 'Ha',
            binning: '1',
            gain: '100',
            night: '2026-06-01',
          },
        }),
      ],
    });

    expect(() => renderPicker()).not.toThrow();

    await waitFor(() => {
      expect(
        screen.getByText(/Unresolved target \/ Ha \/ 2026-06-01/),
      ).toBeInTheDocument();
    });

    // Selecting the row and typing into the target filter must not throw
    // either (the original crash was `undefined.toLowerCase()` in the filter
    // predicate).
    expect(() => {
      fireEvent.change(screen.getByPlaceholderText(/Filter by target/i), {
        target: { value: 'anything' },
      });
    }).not.toThrow();
    expect(
      screen.queryByText(/Unresolved target \/ Ha/),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Filter by target/i), {
      target: { value: '' },
    });
    const checkbox = screen.getByRole('checkbox', {
      name: /Unresolved target session/i,
    });
    expect(() => fireEvent.click(checkbox)).not.toThrow();
  });
});
