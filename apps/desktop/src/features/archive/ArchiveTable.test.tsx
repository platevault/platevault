// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * ArchiveTable — missing-value semantics (spec-030 Q16 / #620, #619, T132).
 *
 * `reason`/`sizeBytes` are `Option` in the contract (a deleted owning plan
 * leaves both unresolved) — the table must render the unresolved chip, never
 * a fabricated empty string / "0 B".
 */

import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ArchiveTable, DEFAULT_ARCHIVE_SORT } from './ArchiveTable';
import type { ArchiveEntry } from '@/bindings/index';

function makeEntry(overrides: Partial<ArchiveEntry> & { id: string }): ArchiveEntry {
  return {
    name: 'NGC 7000 · HOO (v1)',
    entityType: 'project',
    archivedAt: '2024-12-18',
    reason: 'Superseded by reprocess',
    originalPath: 'D:/Astro/Projects/NGC7000_HOO_v1',
    sizeBytes: 12_400_000_000,
    archivedViaPlanId: 'plan-001',
    ...overrides,
  };
}

describe('ArchiveTable — spec-030 Q16 (#620, #619)', () => {
  it('unresolved reason/size render the unresolved chip, never a blank reason or "0 B"', () => {
    const entry = makeEntry({
      id: 'proj-orphan',
      reason: null,
      sizeBytes: null,
    });
    render(
      <ArchiveTable
        entries={[entry]}
        selected={null}
        onSelect={vi.fn()}
        sort={DEFAULT_ARCHIVE_SORT}
        onSort={vi.fn()}
      />,
    );
    const row = screen.getByTestId('archive-row-proj-orphan');
    expect(screen.queryByText('0 B')).toBeNull();
    expect(within(row).getAllByTestId('unresolved-chip').length).toBe(2);
  });

  it('a real reason/size render normally, no unresolved chip', () => {
    const entry = makeEntry({ id: 'proj-real' });
    render(
      <ArchiveTable
        entries={[entry]}
        selected={null}
        onSelect={vi.fn()}
        sort={DEFAULT_ARCHIVE_SORT}
        onSort={vi.fn()}
      />,
    );
    const row = screen.getByTestId('archive-row-proj-real');
    expect(within(row).queryByTestId('unresolved-chip')).toBeNull();
    expect(screen.getByText('Superseded by reprocess')).toBeInTheDocument();
  });
});
