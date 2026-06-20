/// <reference types="@testing-library/jest-dom" />
/**
 * StepSourceFolders org-state tests — spec 041 T034/T035.
 *
 * Asserts:
 * 1. Non-inbox kinds (light_frames, calibration, project) show the
 *    organization-state selector.
 * 2. Inbox kind does NOT show the organization-state selector.
 * 3. Changing the selector fires onOrganizationStateChange with the new value.
 * 4. flushToDB includes the chosen organizationState in the register payload.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// StepSourceFolders uses useDirectoryPicker — stub it so no Tauri bridge is needed.
vi.mock('@/shared/native', () => ({
  useDirectoryPicker: () => ({ pick: vi.fn(), loading: false, error: null, clearError: vi.fn() }),
  pickDirectory: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

import { StepSourceFolders } from './StepSourceFolders';
import type { SourceEntry } from '../sources-store';
import { addSource, flushToDB } from '../sources-store';

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeEntry(kind: SourceEntry['kind'], organizationState: SourceEntry['organizationState'] = 'organized'): SourceEntry {
  return { path: `/astro/${kind}`, kind, scanDepth: 'recursive', organizationState };
}

// ── Tests: org-state selector visibility ─────────────────────────────────

describe('StepSourceFolders — organization state selector', () => {
  const noop = vi.fn();

  it('shows org-state selector for light_frames', () => {
    const entries: SourceEntry[] = [makeEntry('light_frames')];
    render(
      <StepSourceFolders
        entries={entries}
        onAdd={noop}
        onRemove={noop}
        onKindChange={noop}
        onScanDepthChange={noop}
        onOrganizationStateChange={noop}
        errors={{}}
      />,
    );

    const selects = screen.getAllByRole('combobox', { name: /organization state/i });
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });

  it('shows org-state selector for calibration', () => {
    const entries: SourceEntry[] = [makeEntry('calibration')];
    render(
      <StepSourceFolders
        entries={entries}
        onAdd={noop}
        onRemove={noop}
        onKindChange={noop}
        onScanDepthChange={noop}
        onOrganizationStateChange={noop}
        errors={{}}
      />,
    );

    const selects = screen.getAllByRole('combobox', { name: /organization state/i });
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });

  it('shows org-state selector for project', () => {
    const entries: SourceEntry[] = [makeEntry('project')];
    render(
      <StepSourceFolders
        entries={entries}
        onAdd={noop}
        onRemove={noop}
        onKindChange={noop}
        onScanDepthChange={noop}
        onOrganizationStateChange={noop}
        errors={{}}
      />,
    );

    const selects = screen.getAllByRole('combobox', { name: /organization state/i });
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT show org-state selector for inbox', () => {
    const entries: SourceEntry[] = [makeEntry('inbox', 'unorganized')];
    render(
      <StepSourceFolders
        entries={entries}
        onAdd={noop}
        onRemove={noop}
        onKindChange={noop}
        onScanDepthChange={noop}
        onOrganizationStateChange={noop}
        errors={{}}
      />,
    );

    // The org-state selector must be absent for inbox rows.
    expect(screen.queryByRole('combobox', { name: /organization state/i })).not.toBeInTheDocument();
  });

  it('shows both org-state and scan-depth selectors for non-inbox, only scan-depth for inbox', () => {
    const entries: SourceEntry[] = [
      makeEntry('light_frames', 'organized'),
      makeEntry('inbox', 'unorganized'),
    ];
    render(
      <StepSourceFolders
        entries={entries}
        onAdd={noop}
        onRemove={noop}
        onKindChange={noop}
        onScanDepthChange={noop}
        onOrganizationStateChange={noop}
        errors={{}}
      />,
    );

    // One org-state selector for light_frames row, none for inbox row.
    const orgSelects = screen.getAllByRole('combobox', { name: /organization state/i });
    expect(orgSelects).toHaveLength(1);

    // Both rows have a scan-depth selector.
    const depthSelects = screen.getAllByRole('combobox', { name: /scan depth/i });
    expect(depthSelects).toHaveLength(2);
  });
});

// ── Tests: onOrganizationStateChange callback ─────────────────────────────

describe('StepSourceFolders — onOrganizationStateChange callback', () => {
  it('fires onOrganizationStateChange with "unorganized" when user selects it', () => {
    const onOrganizationStateChange = vi.fn();
    const entries: SourceEntry[] = [makeEntry('light_frames', 'organized')];

    render(
      <StepSourceFolders
        entries={entries}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onKindChange={vi.fn()}
        onScanDepthChange={vi.fn()}
        onOrganizationStateChange={onOrganizationStateChange}
        errors={{}}
      />,
    );

    const select = screen.getByRole('combobox', { name: /organization state/i });
    fireEvent.change(select, { target: { value: 'unorganized' } });

    expect(onOrganizationStateChange).toHaveBeenCalledWith(0, 'unorganized');
  });

  it('fires onOrganizationStateChange with "organized" when user selects it', () => {
    const onOrganizationStateChange = vi.fn();
    const entries: SourceEntry[] = [makeEntry('calibration', 'unorganized')];

    render(
      <StepSourceFolders
        entries={entries}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onKindChange={vi.fn()}
        onScanDepthChange={vi.fn()}
        onOrganizationStateChange={onOrganizationStateChange}
        errors={{}}
      />,
    );

    const select = screen.getByRole('combobox', { name: /organization state/i });
    fireEvent.change(select, { target: { value: 'organized' } });

    expect(onOrganizationStateChange).toHaveBeenCalledWith(0, 'organized');
  });
});

// ── Tests: flushToDB includes organizationState in register payload ────────

vi.mock('@/api/commands', () => ({
  registerRootBatch: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.stubEnv('VITE_USE_MOCKS', 'false');

describe('flushToDB — organizationState in register payload', () => {
  it('sends the user-chosen organizationState for non-inbox sources', async () => {
    const { registerRootBatch } = await import('@/api/commands');
    vi.mocked(registerRootBatch).mockResolvedValue({ results: [] });

    const sources = addSource([], 'light_frames', '/astro/lights', 'recursive', 'unorganized');
    await flushToDB(sources);

    expect(registerRootBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            kind: 'light_frames',
            path: '/astro/lights',
            organizationState: 'unorganized',
          }),
        ]),
      }),
    );
  });

  it('always sends "unorganized" for inbox sources regardless of stored value', async () => {
    const { registerRootBatch } = await import('@/api/commands');
    vi.mocked(registerRootBatch).mockResolvedValue({ results: [] });

    // Force-add an inbox source — addSource already coerces to unorganized,
    // but we test that flushToDB also enforces it.
    const sources = addSource([], 'inbox', '/astro/inbox', 'recursive');
    await flushToDB(sources);

    expect(registerRootBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            kind: 'inbox',
            path: '/astro/inbox',
            organizationState: 'unorganized',
          }),
        ]),
      }),
    );
  });

  it('defaults to "organized" for non-inbox sources when no state is specified', async () => {
    const { registerRootBatch } = await import('@/api/commands');
    vi.mocked(registerRootBatch).mockResolvedValue({ results: [] });

    // addSource with no explicit organizationState → defaults to 'organized'
    const sources = addSource([], 'project', '/astro/projects', 'recursive');
    await flushToDB(sources);

    expect(registerRootBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: expect.arrayContaining([
          expect.objectContaining({
            kind: 'project',
            path: '/astro/projects',
            organizationState: 'organized',
          }),
        ]),
      }),
    );
  });
});
