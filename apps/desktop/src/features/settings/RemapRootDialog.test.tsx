// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * RemapRootDialog tests (P6a — Data Sources "Remap" flow).
 *
 * Mocks the generated bindings surface (spec 037) so the real `settingsIpc`
 * wrappers (remapRoot/applyRootRemap) run and unwrap the Result envelope, and
 * stubs the native directory picker (`@/shared/native/picker`) so no Tauri
 * bridge is needed to pick a "new path".
 *
 * Verifies:
 * 1. Renders nothing when `root` is null.
 * 2. Shows the current path and disables Verify until a different path is chosen.
 * 3. Verify calls `roots.remap` and renders the sample list + a success banner
 *    when `allVerified` is true.
 * 4. Renders a warning banner (not an error) when `allVerified` is false.
 * 5. Apply is disabled until a preview exists, then calls `roots.remap.apply`
 *    with the previewed path + `allVerified`, and fires onApplied/onClose.
 * 6. Picking a different path after a preview invalidates it (Apply disables
 *    again until re-verified).
 * 7. A rejected `roots.remap` call surfaces the error message and no preview.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RemapRootDialog } from './RemapRootDialog';
import type { LibraryRoot } from '@/bindings/types';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockRemap, mockRemapApply } = vi.hoisted(() => ({
  mockRemap: vi.fn(),
  mockRemapApply: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsRemap: mockRemap,
    rootsRemapApply: mockRemapApply,
  },
}));

const { mockPick } = vi.hoisted(() => ({ mockPick: vi.fn() }));

vi.mock('@/shared/native/picker', () => ({
  useDirectoryPicker: () => ({
    pick: mockPick,
    loading: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRoot(overrides: Partial<LibraryRoot> = {}): LibraryRoot {
  return {
    id: 'root-1',
    path: '/astro/raw',
    category: 'raw',
    online: true,
    fileCount: 10,
    lastScanned: null,
    active: true,
    ...overrides,
  };
}

async function choosePath(path: string) {
  mockPick.mockResolvedValueOnce({ path, cancelled: false });
  fireEvent.click(screen.getByRole('button', { name: /Choose folder/i }));
  await waitFor(() => screen.getByText(path));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RemapRootDialog', () => {
  it('renders nothing when root is null', () => {
    render(
      <RemapRootDialog root={null} onClose={vi.fn()} onApplied={vi.fn()} />,
    );
    expect(screen.queryByText('Remap root')).toBeNull();
  });

  it('shows the current path and a disabled Verify button before a new path is chosen', () => {
    render(
      <RemapRootDialog
        root={makeRoot()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    );
    expect(screen.getByText('Remap root')).toBeInTheDocument();
    expect(screen.getAllByText('/astro/raw').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Verify$/i })).toBeDisabled();
  });

  it('enables Verify once a different path is chosen, then previews samples on success', async () => {
    mockRemap.mockResolvedValue({
      status: 'ok',
      data: {
        rootId: 'root-1',
        originalPath: '/astro/raw',
        newPath: '/mnt/new/raw',
        samples: [
          { relativePath: 'M31/light_001.fits', found: true },
          { relativePath: 'M31/light_002.fits', found: true },
        ],
        allVerified: true,
      },
    });

    render(
      <RemapRootDialog
        root={makeRoot()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    );
    await choosePath('/mnt/new/raw');

    const verifyBtn = screen.getByRole('button', { name: /^Verify$/i });
    expect(verifyBtn).not.toBeDisabled();
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(screen.getByText('M31/light_001.fits')).toBeInTheDocument();
    });
    expect(mockRemap).toHaveBeenCalledWith('root-1', '/mnt/new/raw');
    expect(
      screen.getByText(/All 2 recorded items were found/i),
    ).toBeInTheDocument();
  });

  it('shows a warning (not an error) when allVerified is false', async () => {
    mockRemap.mockResolvedValue({
      status: 'ok',
      data: {
        rootId: 'root-1',
        originalPath: '/astro/raw',
        newPath: '/mnt/new/raw',
        samples: [{ relativePath: 'M31/light_001.fits', found: false }],
        allVerified: false,
      },
    });

    render(
      <RemapRootDialog
        root={makeRoot()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    );
    await choosePath('/mnt/new/raw');
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/0 of 1 recorded items were found/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Not found')).toBeInTheDocument();
  });

  it('applies the remap with the previewed path + allVerified, then reloads and closes', async () => {
    mockRemap.mockResolvedValue({
      status: 'ok',
      data: {
        rootId: 'root-1',
        originalPath: '/astro/raw',
        newPath: '/mnt/new/raw',
        samples: [],
        allVerified: true,
      },
    });
    mockRemapApply.mockResolvedValue({ status: 'ok', data: null });

    const onApplied = vi.fn();
    const onClose = vi.fn();
    render(
      <RemapRootDialog
        root={makeRoot()}
        onClose={onClose}
        onApplied={onApplied}
      />,
    );

    // Apply disabled before any preview exists.
    expect(screen.getByRole('button', { name: /Apply remap/i })).toBeDisabled();

    await choosePath('/mnt/new/raw');
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/i }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Apply remap/i }),
      ).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Apply remap/i }));

    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(mockRemapApply).toHaveBeenCalledWith('root-1', '/mnt/new/raw', true);
    expect(onClose).toHaveBeenCalled();
  });

  it('invalidates the preview when the path changes again, disabling Apply until re-verified', async () => {
    mockRemap.mockResolvedValue({
      status: 'ok',
      data: {
        rootId: 'root-1',
        originalPath: '/astro/raw',
        newPath: '/mnt/new/raw',
        samples: [],
        allVerified: true,
      },
    });

    render(
      <RemapRootDialog
        root={makeRoot()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    );
    await choosePath('/mnt/new/raw');
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/i }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Apply remap/i }),
      ).not.toBeDisabled(),
    );

    await choosePath('/mnt/other/raw');

    expect(screen.getByRole('button', { name: /Apply remap/i })).toBeDisabled();
  });

  it('surfaces the error message when roots.remap rejects', async () => {
    mockRemap.mockRejectedValue(new Error('disk unavailable'));

    render(
      <RemapRootDialog
        root={makeRoot()}
        onClose={vi.fn()}
        onApplied={vi.fn()}
      />,
    );
    await choosePath('/mnt/new/raw');
    fireEvent.click(screen.getByRole('button', { name: /^Verify$/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Remap failed: disk unavailable/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Apply remap/i })).toBeDisabled();
  });
});
