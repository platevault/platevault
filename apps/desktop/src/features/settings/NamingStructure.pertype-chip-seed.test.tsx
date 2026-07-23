// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Regression test for #820: adding the first chip (Token/Sep/Literal) to a
 * per-type destination pattern row that is still at its built-in default
 * must APPEND to that default, not silently discard it.
 *
 * A row's chip state starts as an empty array whenever no override has been
 * saved — the built-in default (e.g. `bias/`) is only shown as static
 * placeholder text. Before the fix, the "+ Literal"/"+ Token"/"/ " add
 * handlers appended directly onto that empty array, so the first edit
 * produced a pattern containing ONLY the new chip.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
} from '@testing-library/react';
import { NamingStructure } from './NamingStructure';
import { m } from '@/lib/i18n';

const {
  mockSettingsGet,
  mockSettingsUpdate,
  mockPatternValidate,
  mockPatternPreview,
  mockPatternPathPreview,
} = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockSettingsUpdate: vi.fn(),
  mockPatternValidate: vi.fn(),
  mockPatternPreview: vi.fn(),
  mockPatternPathPreview: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: mockSettingsGet,
    settingsUpdate: mockSettingsUpdate,
    patternValidate: mockPatternValidate,
    patternPreview: mockPatternPreview,
    patternPathPreview: mockPatternPathPreview,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockSettingsGet.mockResolvedValue({
    status: 'ok',
    data: { scope: 'naming', values: {} },
  });
  mockSettingsUpdate.mockResolvedValue({ status: 'ok', data: null });
  mockPatternValidate.mockResolvedValue({
    status: 'ok',
    data: { valid: true, warnings: [] },
  });
  mockPatternPreview.mockResolvedValue({
    status: 'ok',
    data: { resolvedPath: 'NGC7000/Ha', missingTokens: [], warnings: [] },
  });
  mockPatternPathPreview.mockResolvedValue({
    status: 'ok',
    data: { resolvedPath: 'bias/testlit', missingTokens: [], warnings: [] },
  });
});

describe('PerTypePatternChipsEditor first-edit seeding (#820)', () => {
  it('adding a literal to a default-only row appends to the default, not discards it', async () => {
    render(<NamingStructure save={vi.fn()} />);

    const row = await waitFor(() => screen.getByTestId('naming-pattern-bias'));

    fireEvent.click(within(row).getByText(m.settings_naming_add_literal()));
    fireEvent.change(
      within(row).getByLabelText(m.settings_naming_literal_aria()),
      {
        target: { value: 'testlit' },
      },
    );
    fireEvent.click(within(row).getByText(m.common_add()));

    await waitFor(() => {
      expect(mockSettingsUpdate).toHaveBeenCalled();
    });

    const lastCall =
      mockSettingsUpdate.mock.calls[mockSettingsUpdate.mock.calls.length - 1];
    // commands.settingsUpdate(scope, values) — two positional args.
    const values = lastCall[1] as { patternsByType: Record<string, string> };
    // Must be "bias/testlit" (default segment preserved), not "testlit".
    expect(values.patternsByType.bias).toBe('bias/testlit');
  });
});
