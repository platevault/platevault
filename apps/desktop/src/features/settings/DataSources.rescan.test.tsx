// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * DataSources "Rescan" flow tests (P6a).
 *
 * The Rescan button used to call `startScan`/`scan.start` — a dead stub that
 * logs and returns a fake operation handle without touching the database, so
 * `lastScanned` never updated and the button silently no-op'd in production.
 * It now calls the real `inbox.scan_folder` command (the same one the setup
 * wizard and the Inbox page's "Rescan all" use), which persists
 * `inbox_source_groups` rows that `roots.list`'s `lastScanned` is derived
 * from.
 *
 * Verifies:
 * 1. Clicking Rescan invokes the real `inbox.scan_folder` command with the
 *    root's id + absolute path (NOT `scan.start`).
 * 2. The roots list is reloaded only after the scan actually completes (no
 *    fixed-delay guess), so a real `lastScanned` value can appear.
 * 3. The button shows a disabled "Rescanning…" state while in flight.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { DataSources } from './DataSources';
import { queryClient } from '@/data/queryClient';
import type { LibraryRoot } from '@/bindings/types';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Mocks the generated bindings surface (spec 037) so the real `settingsIpc`
// wrappers (listRoots/rescanRoot/etc.) run and unwrap the Result envelope.

const {
  mockRootsList,
  mockScanFolder,
  mockSourceProtectionGet,
  mockOverridableKeys,
} = vi.hoisted(() => ({
  mockRootsList: vi.fn(),
  mockScanFolder: vi.fn(),
  mockSourceProtectionGet: vi.fn(),
  mockOverridableKeys: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsList: mockRootsList,
    inboxScanFolder: mockScanFolder,
    sourceProtectionGet: mockSourceProtectionGet,
    settingsOverridableKeys: mockOverridableKeys,
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRoot(overrides: Partial<LibraryRoot> = {}): LibraryRoot {
  return {
    id: 'root-1',
    path: '/astro/raw',
    category: 'raw',
    online: true,
    fileCount: 0,
    lastScanned: null,
    active: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSourceProtectionGet.mockResolvedValue({
    status: 'ok',
    data: {
      sourceId: 'root-1',
      level: 'normal',
      blockPermanentDelete: false,
      categories: [],
      inheritsDefault: true,
    },
  });
  mockOverridableKeys.mockResolvedValue({
    status: 'ok',
    data: ['hashOnScan', 'followSymlinks'],
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

/** Issue #562: per-source actions live inside the kebab (⋯) menu now. */
function openKebab() {
  fireEvent.click(screen.getByRole('button', { name: /Source actions/i }));
}

describe('DataSources — Rescan', () => {
  it('calls the real inbox.scan_folder command and reloads roots on completion', async () => {
    mockRootsList
      .mockResolvedValueOnce({
        status: 'ok',
        data: [makeRoot({ lastScanned: null })],
      })
      .mockResolvedValueOnce({
        status: 'ok',
        data: [makeRoot({ lastScanned: '2026-07-03T12:00:00Z' })],
      });
    mockScanFolder.mockResolvedValue({ status: 'ok', data: { items: [] } });

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() => screen.getByText('/astro/raw', { selector: 'code' }));

    openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Rescan$/i }));

    await waitFor(() => {
      expect(mockScanFolder).toHaveBeenCalledWith({
        rootId: 'root-1',
        rootAbsolutePath: '/astro/raw',
        followSymlinks: false,
      });
    });

    // Reloaded exactly once more (mount + post-scan) — no setTimeout guess.
    await waitFor(() => {
      expect(mockRootsList).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getByText(/scanned/i)).toBeInTheDocument();
    });
  });

  it('shows a disabled "Rescanning…" state while the scan is in flight', async () => {
    mockRootsList.mockResolvedValue({ status: 'ok', data: [makeRoot()] });
    let resolveScan: ((value: unknown) => void) | undefined;
    mockScanFolder.mockReturnValue(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() => screen.getByText('/astro/raw', { selector: 'code' }));

    openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Rescan$/i }));

    // The kebab menu stays open across a Rescan click (unlike other items)
    // so the disabled/relabeled state remains visible.
    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: /Rescanning/i }),
      ).toBeDisabled();
    });

    resolveScan?.({ status: 'ok', data: { items: [] } });

    await waitFor(() => {
      expect(
        screen.getByRole('menuitem', { name: /^Rescan$/i }),
      ).not.toBeDisabled();
    });
  });

  it('does not call the dead scan.start stub', async () => {
    mockRootsList.mockResolvedValue({ status: 'ok', data: [makeRoot()] });
    mockScanFolder.mockResolvedValue({ status: 'ok', data: { items: [] } });

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() => screen.getByText('/astro/raw', { selector: 'code' }));

    openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Rescan$/i }));

    await waitFor(() => expect(mockScanFolder).toHaveBeenCalled());
    // `scan_start` was never wired into the mocked commands object at all —
    // this is enforced structurally (no `scanStart` key above) rather than by
    // a spy, since the whole point is that the frontend wrapper is gone.
  });
});
