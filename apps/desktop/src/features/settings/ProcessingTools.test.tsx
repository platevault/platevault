// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ProcessingTools pane — path-edit side effects (#656, #825).
 *
 * Covers:
 *   1. Editing a disabled tool's path preserves `enabled: false` instead of
 *      hardcoding `enabled: true` on every save.
 *   2. A rejected path save (e.g. non-absolute path) surfaces inline instead
 *      of being lost as an unhandled promise rejection, and does not leave a
 *      stale Available/Missing pill implying the save succeeded.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockList, mockUpdate, mockValidate } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockUpdate: vi.fn(),
  mockValidate: vi.fn(),
}));

vi.mock('./settingsIpc', () => ({
  toolProfileList: mockList,
  toolUpdate: mockUpdate,
  toolValidatePath: mockValidate,
  toolDiscover: vi.fn().mockResolvedValue({ entries: [] }),
}));

import { ProcessingTools } from './ProcessingTools';

const SIRIL = {
  id: 'siril',
  name: 'Siril',
  executablePath: 'C:\\Siril\\siril.exe',
  enabled: false,
  configured: true,
  available: true,
  autoDetected: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockList.mockResolvedValue({ tools: [SIRIL] });
  mockValidate.mockResolvedValue({ valid: true });
});

describe('ProcessingTools — path-edit side effects', () => {
  it('preserves a disabled tool as disabled when its path is edited (#656)', async () => {
    mockUpdate.mockResolvedValue({
      ...SIRIL,
      executablePath: 'C:\\new\\siril.exe',
    });
    render(<ProcessingTools />);

    const input = await screen.findByLabelText('Executable path for Siril');
    fireEvent.change(input, { target: { value: 'C:\\new\\siril.exe' } });
    fireEvent.blur(input);

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'siril', enabled: false }),
    );
  });

  it('surfaces a rejected path save inline instead of an unhandled rejection (#825)', async () => {
    mockUpdate.mockRejectedValue(
      new Error("executable_path for 'siril' must be absolute; got 'x'"),
    );
    render(<ProcessingTools />);

    const input = await screen.findByLabelText('Executable path for Siril');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.blur(input);

    expect(
      await screen.findByText(
        "Could not save the path for Siril: executable_path for 'siril' must be absolute; got 'x'",
      ),
    ).toBeInTheDocument();
    // The stale "Available" pill from the last successful load must not be
    // left standing as if the rejected save had succeeded.
    expect(mockValidate).not.toHaveBeenCalled();
  });
});
