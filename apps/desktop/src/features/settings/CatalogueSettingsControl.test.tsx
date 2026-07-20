// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * CatalogueSettingsControl tests.
 *
 * Focus: the mount-read vs user-edit race. The control loads the persisted
 * default catalogues asynchronously on mount; if the user toggles a catalogue
 * before that read resolves, the in-flight response must not overwrite their
 * choice. Same defect class as LogPanelContext (`followTouchedRef`), Settings >
 * Cleanup (`editedRef`) and guidance-settings (`writeGen`).
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLoad, mockSave } = vi.hoisted(() => ({
  mockLoad: vi.fn(),
  mockSave: vi.fn(),
}));

vi.mock('@/features/targets/catalogue-settings', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/features/targets/catalogue-settings')
    >();
  return {
    ...actual,
    loadDefaultCatalogues: mockLoad,
    saveDefaultCatalogues: mockSave,
  };
});

import { CatalogueSettingsControl } from './CatalogueSettingsControl';
import { PLANNER_CATALOGS } from '@/features/targets/planner-catalog';
import { DEFAULT_ENABLED_CATALOGUES } from '@/features/targets/catalogue-settings';
import { m } from '@/lib/i18n';

beforeEach(() => {
  mockLoad.mockReset();
  mockSave.mockReset();
  mockSave.mockResolvedValue(undefined);
});

/** First catalogue that is enabled by default — toggling it off is a change. */
function firstDefaultOn() {
  const c = PLANNER_CATALOGS.find((c) =>
    DEFAULT_ENABLED_CATALOGUES.includes(c.id),
  );
  if (!c) throw new Error('no default-enabled catalogue to exercise');
  return c;
}

/** `Toggle` renders an `<input type="checkbox">`, so the role is checkbox. */
function toggleFor(c: { label: () => string }) {
  return screen.getByRole('checkbox', {
    name: m.settings_catalogue_enable_default_aria({ label: c.label() }),
  });
}

describe('CatalogueSettingsControl mount-read vs user-toggle race', () => {
  it('does not let the in-flight mount read clobber a toggle made while it was pending', async () => {
    // Hold the mount load open so the user can toggle while it is in flight.
    let resolveLoad!: (v: readonly string[]) => void;
    mockLoad.mockReturnValue(
      new Promise((resolve) => {
        resolveLoad = resolve as (v: readonly string[]) => void;
      }),
    );

    const target = firstDefaultOn();
    render(<CatalogueSettingsControl />);

    const toggle = toggleFor(target);
    expect(toggle).toBeChecked();

    // User turns it off before the read resolves. `persist` has already written
    // this to the settings backend, so a clobber would leave the UI showing a
    // value the backend no longer holds.
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(mockSave).toHaveBeenCalled();

    // The stale read lands, still carrying the pre-toggle defaults.
    await act(async () => {
      resolveLoad([...DEFAULT_ENABLED_CATALOGUES]);
    });

    // Assert directly, NOT via waitFor — waitFor can succeed on its first check
    // before the clobber lands and so passes even with the fix removed.
    expect(toggle).not.toBeChecked();
  });

  it('still applies the persisted value when the user has not touched anything', async () => {
    // The guard must not disable the load outright — only defer to real intent.
    const target = firstDefaultOn();
    const withoutTarget = DEFAULT_ENABLED_CATALOGUES.filter(
      (id) => id !== target.id,
    );
    mockLoad.mockResolvedValue([...withoutTarget]);

    render(<CatalogueSettingsControl />);

    await act(async () => {});

    expect(toggleFor(target)).not.toBeChecked();
  });
});
