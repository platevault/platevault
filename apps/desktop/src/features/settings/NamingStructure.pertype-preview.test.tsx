/**
 * Vitest unit tests for the per-type destination pattern live preview
 * (spec 041 package P11 — real `pattern.path_preview` backend wiring).
 *
 * Covers the i18n-review corrections:
 *  - a ContractError from the preview command resolves through `errMessage()`
 *    to its translated catalog entry (e.g. `pattern.empty` → m.err_pattern_empty),
 *    NOT the generic "preview unavailable" string and NOT the raw code;
 *  - `missingTokens` from the response is surfaced via
 *    m.settings_naming_fallback_used, mirroring the top-level preview.
 *
 * Mocks the generated bindings surface (spec 037 pattern, same as
 * SourceProtectionOverride.test.tsx) so the real `settingsIpc` wrappers,
 * `unwrap()` envelope handling, and `errMessage()` catalog resolution all run.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { NamingStructure } from './NamingStructure';
import { m } from '@/lib/i18n';

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A well-formed ContractError envelope, as the real backend throws it. */
function contractError(code: string, message: string) {
  return {
    code,
    message,
    severity: 'blocking',
    retryable: false,
    details: null,
  };
}

function okPathPreview(resolvedPath: string, missingTokens: string[] = []) {
  return {
    status: 'ok' as const,
    data: { resolvedPath, missingTokens, warnings: [] },
  };
}

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
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('per-type destination pattern preview (P11)', () => {
  it('renders the backend-resolved sample path per frame-type class', async () => {
    mockPatternPathPreview.mockResolvedValue(
      okPathPreview('IC1396/Ha/2024-10-20/light'),
    );
    render(<NamingStructure save={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('naming-pattern-light-preview')).toBeTruthy();
    });
    expect(
      screen.getByTestId('naming-pattern-light-preview').textContent,
    ).toContain('IC1396/Ha/2024-10-20/light');
  });

  it('surfaces missingTokens via the fallback-used catalog message', async () => {
    mockPatternPathPreview.mockResolvedValue(
      okPathPreview('flats/nofilter/2024-10-20', ['filter']),
    );
    render(<NamingStructure save={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('naming-pattern-flat-preview')).toBeTruthy();
    });
    expect(
      screen.getByTestId('naming-pattern-flat-preview').textContent,
    ).toContain(m.settings_naming_fallback_used({ tokens: 'filter' }));
  });

  it('resolves a ContractError to its translated catalog message, not the generic fallback', async () => {
    mockPatternPathPreview.mockResolvedValue({
      status: 'error',
      error: contractError('pattern.empty', 'Pattern is empty.'),
    });
    render(<NamingStructure save={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByTestId('naming-pattern-light-preview-error'),
      ).toBeTruthy();
    });
    const text = screen.getByTestId(
      'naming-pattern-light-preview-error',
    ).textContent;
    // The registry entry for pattern.empty — the specific, translated message.
    expect(text).toBe(m.err_pattern_empty());
    // NOT the generic "preview unavailable" string...
    expect(text).not.toBe(m.settings_naming_preview_unavailable());
    // ...and NOT the raw error code or raw backend diagnostic.
    expect(text).not.toContain('pattern.empty');
    expect(text).not.toBe('Pattern is empty.');
  });

  it('resolves token.unknown to its translated catalog message', async () => {
    mockPatternPathPreview.mockResolvedValue({
      status: 'error',
      error: contractError('token.unknown', 'Unknown token: telescope'),
    });
    render(<NamingStructure save={vi.fn()} />);

    await waitFor(() => {
      expect(
        screen.getByTestId('naming-pattern-dark-preview-error'),
      ).toBeTruthy();
    });
    expect(
      screen.getByTestId('naming-pattern-dark-preview-error').textContent,
    ).toBe(m.err_token_unknown());
  });
});
