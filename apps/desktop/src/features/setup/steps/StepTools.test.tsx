// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * StepTools tests — first-run wizard "Processing Tools" step.
 *
 * Covers #511 (executable-only picker filter + post-pick validation) and
 * #510 (single status pill, icon-only Redetect button).
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryClient } from '@/data/queryClient';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const { mockPick, mockToolsDiscover } = vi.hoisted(() => ({
  mockPick: vi.fn(),
  mockToolsDiscover: vi.fn(),
}));

vi.mock('@/shared/native/picker', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/native/picker')>();
  return {
    ...actual,
    useFilePicker: () => ({
      pick: mockPick,
      loading: false,
      error: null,
      clearError: vi.fn(),
    }),
  };
});

vi.mock('@/bindings/index', () => ({
  commands: {
    toolsDiscover: mockToolsDiscover,
  },
}));

import { StepTools, DEFAULT_TOOLS_STATE, type ToolsState } from './StepTools';
import type { FileFilter } from '@/shared/native/picker';

beforeEach(() => {
  mockPick.mockReset();
  mockToolsDiscover.mockReset();
  mockToolsDiscover.mockResolvedValue({ status: 'ok', data: { entries: [] } });
  queryClient.clear();
});

function renderStep(tools: ToolsState, onToolsChange = vi.fn()) {
  return {
    onToolsChange,
    ...render(<StepTools tools={tools} onToolsChange={onToolsChange} />, {
      wrapper,
    }),
  };
}

describe('StepTools', () => {
  it('filters the picker to executables only, without an "all files" fallback (#511)', async () => {
    mockPick.mockResolvedValue({
      path: null,
      selectedFilter: null,
      cancelled: true,
    });
    const tools: ToolsState = {
      ...DEFAULT_TOOLS_STATE,
      pixinsight: { enabled: true, path: null },
    };
    renderStep(tools);

    fireEvent.click(
      screen.getByRole('button', { name: 'Select PixInsight binary' }),
    );

    await waitFor(() => expect(mockPick).toHaveBeenCalled());
    const filters = mockPick.mock.calls[0][0] as FileFilter[];
    expect(filters).toHaveLength(1);
    expect(filters[0].extensions).not.toContain('*');
  });

  it('rejects a picked non-executable with an inline error instead of "OK" (#511)', async () => {
    mockPick.mockResolvedValue({
      path: 'D:\\Tools\\setiastrosuite_windows.zip',
      selectedFilter: null,
      cancelled: false,
    });
    const tools: ToolsState = {
      ...DEFAULT_TOOLS_STATE,
      pixinsight: { enabled: true, path: null },
    };
    const { onToolsChange, rerender } = renderStep(tools);

    fireEvent.click(
      screen.getByRole('button', { name: 'Select PixInsight binary' }),
    );
    await waitFor(() => expect(onToolsChange).toHaveBeenCalled());

    const next = onToolsChange.mock.calls[0][0] as ToolsState;
    rerender(<StepTools tools={next} onToolsChange={onToolsChange} />);

    expect(screen.getByText('Invalid')).toBeInTheDocument();
    expect(
      screen.getByText(/doesn't look like an executable/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('OK')).toBeNull();
  });

  it('shows a single "Detected" pill (no duplicate OK pill) for a valid path (#510)', () => {
    const tools: ToolsState = {
      ...DEFAULT_TOOLS_STATE,
      pixinsight: {
        enabled: true,
        path: 'C:\\Program Files\\PixInsight\\bin\\PixInsight.exe',
      },
    };
    renderStep(tools);

    expect(screen.getByText('Detected')).toBeInTheDocument();
    expect(screen.queryByText('OK')).toBeNull();
  });

  it('renders Redetect as an icon-only button with an accessible label (#510)', () => {
    renderStep(DEFAULT_TOOLS_STATE);

    const btn = screen.getByRole('button', {
      name: 'Redetect PixInsight binary',
    });
    expect(btn).toBeInTheDocument();
    expect(btn).not.toHaveTextContent('Redetect');
  });

  it('announces redetection transitions in the tool-scoped polite region without moving focus', async () => {
    renderStep(DEFAULT_TOOLS_STATE);
    await waitFor(() => expect(mockToolsDiscover).toHaveBeenCalled());

    let resolveRedetect!: (value: unknown) => void;
    mockToolsDiscover.mockReset();
    mockToolsDiscover.mockReturnValue(
      new Promise((resolve) => {
        resolveRedetect = resolve;
      }),
    );

    const card = screen.getByTestId('tool-card-pixinsight');
    const status = within(card).getByRole('status');
    const button = within(card).getByRole('button', {
      name: 'Redetect PixInsight binary',
    });
    button.focus();
    fireEvent.click(button);

    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(status).toHaveTextContent('PixInsightDetecting PixInsight…');
    expect(button).toHaveFocus();

    resolveRedetect({ status: 'ok', data: { entries: [] } });
    await waitFor(() =>
      expect(status).toHaveTextContent('PixInsightNo installation found'),
    );
    expect(button).toHaveFocus();
  });

  it('clears failed redetection feedback after a valid executable is selected manually', async () => {
    const tools: ToolsState = {
      ...DEFAULT_TOOLS_STATE,
      pixinsight: {
        enabled: true,
        path: 'C:\\Program Files\\PixInsight\\bin\\PixInsight.exe',
      },
    };
    const { onToolsChange, rerender } = renderStep(tools);
    await waitFor(() => expect(mockToolsDiscover).toHaveBeenCalled());

    mockToolsDiscover.mockReset();
    mockToolsDiscover.mockResolvedValue({
      status: 'ok',
      data: { entries: [] },
    });

    const card = screen.getByTestId('tool-card-pixinsight');
    fireEvent.click(
      within(card).getByRole('button', {
        name: 'Redetect PixInsight binary',
      }),
    );

    await waitFor(() =>
      expect(within(card).getByRole('status')).toHaveTextContent(
        'PixInsightNo installation found',
      ),
    );
    expect(within(card).getByText('No installation found')).toBeVisible();

    mockPick.mockResolvedValue({
      path: 'D:\\Tools\\PixInsight.exe',
      selectedFilter: null,
      cancelled: false,
    });
    fireEvent.click(
      within(card).getByRole('button', {
        name: 'Select PixInsight binary',
      }),
    );

    await waitFor(() => expect(onToolsChange).toHaveBeenCalled());
    const next = onToolsChange.mock.calls.at(-1)?.[0] as ToolsState;
    rerender(<StepTools tools={next} onToolsChange={onToolsChange} />);

    expect(within(card).queryByText('No installation found')).toBeNull();
    expect(within(card).getByRole('status')).toHaveTextContent(
      'PixInsightDetected',
    );
    expect(within(card).getByText('D:\\Tools\\PixInsight.exe')).toBeVisible();
  });
});
