// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * StepSourceFolders — required-first ordering, help tooltips, add-time
 * validation, and scan-depth removal (issues #496, #497/#714, #502, #509).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const mockPick = vi.fn();

vi.mock('@/shared/native', () => ({
  useDirectoryPicker: () => ({
    pick: mockPick,
    loading: false,
    error: null,
    clearError: vi.fn(),
  }),
  pickDirectory: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

import { StepSourceFolders } from './StepSourceFolders';
import type { SourceEntry } from '../sources-store';

function makeEntry(path: string, kind: SourceEntry['kind']): SourceEntry {
  return { path, kind, scanDepth: 'recursive', organizationState: 'organized' };
}

const noop = vi.fn();

function renderStep(entries: SourceEntry[], onAdd = vi.fn()) {
  return render(
    <StepSourceFolders
      entries={entries}
      onAdd={onAdd}
      onRemove={noop}
      onKindChange={noop}
      onScanDepthChange={noop}
      onOrganizationStateChange={noop}
      errors={{}}
    />,
  );
}

// ── Required-first ordering (#496) ──────────────────────────────────────

describe('StepSourceFolders — required-first ordering', () => {
  it('renders both required groups before both optional groups, under Required/Optional headings', () => {
    renderStep([]);

    const groups = screen
      .getAllByTestId(/^source-group-/)
      .map((el) => el.dataset.testid);
    expect(groups).toEqual([
      'source-group-light_frames',
      'source-group-project',
      'source-group-calibration',
      'source-group-inbox',
    ]);

    const headings = screen
      .getAllByText(/^(Required|Optional)$/)
      .map((el) => el.textContent);
    expect(headings).toEqual(['Required', 'Optional']);
  });
});

// ── Contextual help tooltips (#497, #714) ───────────────────────────────

describe('StepSourceFolders — category help tooltips', () => {
  it('exposes an accessible, keyboard-focusable help affordance for every category', () => {
    renderStep([]);

    // aria-label mirrors the tip text, so it is available without hover
    // (screen-reader accessible per #497) — this also proves each category
    // has distinct explanatory copy (#714).
    expect(
      screen.getByLabelText(/More information: Raw light frames/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/More information: Dark, flat, and bias frames/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        /More information: Folders where your PixInsight\/WBPP projects/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/More information: An optional drop folder/i),
    ).toBeInTheDocument();
  });

  it('help affordances are focusable (tabIndex 0), not hover-only', () => {
    renderStep([]);
    const tip = screen.getByLabelText(/More information: Raw light frames/i);
    expect(tip).toHaveAttribute('tabIndex', '0');
  });
});

// ── Scan-depth control removed (#509) ───────────────────────────────────

describe('StepSourceFolders — scan-depth control removal', () => {
  it('no longer renders a scan-depth selector for any source row', () => {
    renderStep([makeEntry('/astro/lights', 'light_frames')]);
    expect(
      screen.queryByRole('combobox', { name: /scan depth/i }),
    ).not.toBeInTheDocument();
  });
});

// ── Add-time path validation (#502) ─────────────────────────────────────

describe('StepSourceFolders — add-time validation', () => {
  it('rejects a duplicate path within the same kind with an inline, accessible error and does not call onAdd', async () => {
    const onAdd = vi.fn();
    mockPick.mockResolvedValue({ path: '/astro/lights' });
    renderStep([makeEntry('/astro/lights', 'light_frames')], onAdd);

    fireEvent.click(
      screen.getByRole('button', { name: /add light frames folder/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /already added/i,
    );
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('rejects a path already registered under a different kind, naming the other category', async () => {
    const onAdd = vi.fn();
    mockPick.mockResolvedValue({ path: '/astro/lights' });
    renderStep([makeEntry('/astro/lights', 'light_frames')], onAdd);

    fireEvent.click(
      screen.getByRole('button', { name: /add calibration frames folder/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /registered under Light frames/i,
    );
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('rejects a folder nested inside an already added folder (no-overlap rule)', async () => {
    const onAdd = vi.fn();
    mockPick.mockResolvedValue({ path: '/astro/lights/sub' });
    renderStep([makeEntry('/astro/lights', 'light_frames')], onAdd);

    fireEvent.click(
      screen.getByRole('button', { name: /add light frames folder/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/overlaps/i);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('rejects a folder that is an ancestor of an already added folder', async () => {
    const onAdd = vi.fn();
    mockPick.mockResolvedValue({ path: '/astro' });
    renderStep([makeEntry('/astro/lights', 'light_frames')], onAdd);

    fireEvent.click(
      screen.getByRole('button', { name: /add light frames folder/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/overlaps/i);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('calls onAdd for a clear, non-overlapping path', async () => {
    const onAdd = vi.fn();
    mockPick.mockResolvedValue({ path: '/astro/lights2' });
    renderStep([makeEntry('/astro/lights', 'light_frames')], onAdd);

    fireEvent.click(
      screen.getByRole('button', { name: /add light frames folder/i }),
    );

    await waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith('/astro/lights2', 'light_frames'),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
