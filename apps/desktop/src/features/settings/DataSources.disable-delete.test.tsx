// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * DataSources "Disable/Enable" + "Delete" flow tests (P6b; issue #562 kebab
 * consolidation; issue #559 always-reachable Delete).
 *
 * Both actions used to be `console.log` stubs (`sources.set_active` and
 * `roots.delete` were unwired). Verifies:
 *
 * 1. Clicking "Disable" (kebab item) opens a confirm dialog; confirming
 *    calls `sources.set_active` with `active: false` and reloads the roots
 *    list.
 * 2. Clicking "Enable" (a disabled root) calls `sources.set_active` with
 *    `active: true` immediately — no confirm dialog for the restorative action.
 * 3. Clicking "Delete" opens a confirm dialog; confirming calls
 *    `roots.delete` and reloads the roots list.
 * 4. Issue #559: Delete is reachable for BOTH online and offline roots (it
 *    used to be hidden unless the root was already offline, making the
 *    backend `roots_delete` command unreachable from the UI in the common
 *    case).
 * 5. Decision D8: when `roots.delete` is blocked by the backend
 *    (`root.has_dependents`), the confirm dialog stays open and surfaces the
 *    catalog-mapped block reason instead of silently closing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { DataSources } from './DataSources';
import { queryClient } from '@/data/queryClient';
import type { LibraryRoot } from '@/bindings/types';
import { m } from '@/lib/i18n';

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Mocks the generated bindings surface (spec 037) so the real `settingsIpc`
// wrappers (listRoots/setRootActive/deleteRoot/etc.) run and unwrap the
// Result envelope.

const {
  mockRootsList,
  mockSetActive,
  mockDelete,
  mockSourceProtectionGet,
  mockOverridableKeys,
} = vi.hoisted(() => ({
  mockRootsList: vi.fn(),
  mockSetActive: vi.fn(),
  mockDelete: vi.fn(),
  mockSourceProtectionGet: vi.fn(),
  mockOverridableKeys: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    rootsList: mockRootsList,
    sourcesSetActive: mockSetActive,
    rootsDelete: mockDelete,
    sourceProtectionGet: mockSourceProtectionGet,
    settingsOverridableKeys: mockOverridableKeys,
  },
}));

const ok = <T,>(data: T) => ({ status: 'ok' as const, data });
const err = (error: unknown) => ({ status: 'error' as const, error });

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
  mockSourceProtectionGet.mockResolvedValue(
    ok({
      sourceId: 'root-1',
      level: 'unprotected',
      blockPermanentDelete: false,
      categories: [],
      inheritsDefault: true,
    }),
  );
  mockOverridableKeys.mockResolvedValue(ok(['defaultProtection']));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

/** Issue #562: per-source actions live inside the kebab (⋯) menu now. */
function openKebab() {
  fireEvent.click(screen.getByRole('button', { name: /Source actions/i }));
}

describe('DataSources — Disable/Enable', () => {
  it('opens a confirm dialog and calls sources.set_active(false) on confirm', async () => {
    mockRootsList
      .mockResolvedValueOnce(ok([makeRoot({ active: true })]))
      .mockResolvedValueOnce(ok([makeRoot({ active: false })]));
    mockSetActive.mockResolvedValue(ok(null));

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() => screen.getByText('/astro/raw', { selector: 'code' }));

    openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Disable$/i }));

    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: /^Disable$/i }),
      );
      await Promise.resolve();
    });

    expect(mockSetActive).toHaveBeenCalledWith('root-1', false);
    await waitFor(() => expect(mockRootsList).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('calls sources.set_active(true) immediately for a disabled root — no confirm', async () => {
    mockRootsList.mockResolvedValue(ok([makeRoot({ active: false })]));
    mockSetActive.mockResolvedValue(ok(null));

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() => screen.getByText('/astro/raw', { selector: 'code' }));

    openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Enable$/i }));

    await waitFor(() => {
      expect(mockSetActive).toHaveBeenCalledWith('root-1', true);
    });
    // No confirm dialog for the restorative action.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a "Disabled" pill for a disabled root', async () => {
    mockRootsList.mockResolvedValue(ok([makeRoot({ active: false })]));

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() => screen.getByText('/astro/raw', { selector: 'code' }));

    expect(
      screen.getByText(m.settings_datasources_disabled_pill()),
    ).toBeInTheDocument();
  });
});

describe('DataSources — Delete', () => {
  it('opens a confirm dialog and calls roots.delete on confirm (offline root)', async () => {
    mockRootsList
      .mockResolvedValueOnce(ok([makeRoot({ online: false })]))
      .mockResolvedValueOnce(ok([]));
    mockDelete.mockResolvedValue(ok(null));

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() => screen.getByText('/astro/raw', { selector: 'code' }));

    openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Delete$/i }));

    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: /^Delete$/i }),
      );
      await Promise.resolve();
    });

    expect(mockDelete).toHaveBeenCalledWith('root-1');
    await waitFor(() => expect(mockRootsList).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // Issue #559: Delete used to be hidden for online roots, making the
  // backend `roots_delete` command unreachable from the UI in the common
  // case. It is now always in the kebab menu regardless of online status.
  it('shows a Delete menu item for an online root too', async () => {
    mockRootsList
      .mockResolvedValueOnce(ok([makeRoot({ online: true })]))
      .mockResolvedValueOnce(ok([]));
    mockDelete.mockResolvedValue(ok(null));

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() => screen.getByText('/astro/raw', { selector: 'code' }));

    openKebab();
    const deleteItem = screen.getByRole('menuitem', { name: /^Delete$/i });
    expect(deleteItem).toBeInTheDocument();

    fireEvent.click(deleteItem);
    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: /^Delete$/i }),
      );
      await Promise.resolve();
    });

    expect(mockDelete).toHaveBeenCalledWith('root-1');
  });

  it('D8: keeps the dialog open and surfaces the block reason when root.has_dependents', async () => {
    mockRootsList.mockResolvedValue(ok([makeRoot({ online: false })]));
    mockDelete.mockResolvedValue(
      err({
        code: 'root.has_dependents',
        message: 'root root-1 has dependent records and cannot be deleted',
        severity: 'blocking',
        retryable: false,
        details: {
          inboxItems: 1,
          planItems: 0,
          fileRecords: 0,
          acquisitionSessions: 0,
          calibrationSessions: 0,
        },
      }),
    );

    render(<DataSources save={vi.fn()} />, { wrapper });
    await waitFor(() => screen.getByText('/astro/raw', { selector: 'code' }));

    openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Delete$/i }));

    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', { name: /^Delete$/i }),
      );
      await Promise.resolve();
    });

    expect(mockDelete).toHaveBeenCalledWith('root-1');
    // The dialog stays open — the block reason must be surfaced, not swallowed.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(m.err_root_has_dependents())).toBeInTheDocument();
    // The root was NOT removed from the list (no optimistic/premature removal).
    expect(
      screen.getByText('/astro/raw', { selector: 'code' }),
    ).toBeInTheDocument();
  });
});
