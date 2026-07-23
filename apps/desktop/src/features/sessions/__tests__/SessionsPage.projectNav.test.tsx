// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * SessionsPage regression tests (#865, #652):
 *
 * #865 — clicking a session's linked-project chip must navigate to
 * `/projects` WITH the clicked project's id (`search: { selected: id }`),
 * not drop it and land on an unselected Projects list.
 * #652 — the Type filter defaults to `light` (acquisition) so the table's
 * row count matches the acquisition-only sidebar/status-bar count.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import type { InventorySource } from '@/bindings/index';

// Children that would otherwise hit IPC/query-cache — stub them so this test
// isolates SessionsPage's own navigation/filter wiring (same isolation as
// SessionDetail.test.tsx).
vi.mock('../SessionFrameInventory', () => ({
  SessionFrameInventory: () => null,
}));
vi.mock('../RawFrameCleanupSection', () => ({
  RawFrameCleanupSection: () => null,
}));
vi.mock('../SessionNotesSection', () => ({ SessionNotesSection: () => null }));

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
  useToasts: () => ({ toasts: [], dismiss: vi.fn() }),
}));

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => ({ selected: 'sess-1', sourceFilter: undefined }),
}));

const PROJECT_SOURCE: InventorySource = {
  id: 'root-1',
  path: '/home/user/astrophotos',
  kind: 'local_disk',
  state: 'active',
  sessions: [
    {
      id: 'sess-1',
      name: 'M 51 · L — 2025-05-03',
      sourceId: 'root-1',
      frames: 2,
      type: 'light',
      target: 'M 51',
      filter: 'L',
      exposure: null,
      capturedOn: '2025-05-03',
      relativePath: null,
      linked: { projects: [{ id: 'proj-42', name: 'M 51 · LRGB' }] },
    },
  ],
} as InventorySource;

const mockStoreState: {
  data: { sources: InventorySource[] } | undefined;
  loading: boolean;
  error: Error | undefined;
} = { data: { sources: [PROJECT_SOURCE] }, loading: false, error: undefined };

vi.mock('../store', async (importOriginal) => {
  const original = await importOriginal<typeof import('../store')>();
  return {
    ...original,
    useInventorySources: vi.fn(() => mockStoreState),
  };
});

import { SessionsPage } from '../SessionsPage';

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionsPage />
    </QueryClientProvider>,
  );
}

describe('SessionsPage — project-chip navigation (#865)', () => {
  it('clicking the linked-project chip navigates to /projects WITH the id', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'M 51 · LRGB' }));
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/projects',
      search: { selected: 'proj-42' },
    });
  });
});

describe('SessionsPage — Type filter defaults to acquisition (#652)', () => {
  it('the Type field is present and defaults to Light (matches the acquisition-only chrome count)', () => {
    renderPage();
    const select = screen.getByRole('combobox', {
      name: /Type/i,
    }) as HTMLSelectElement;
    expect(select.value).toBe('light');
  });
});
