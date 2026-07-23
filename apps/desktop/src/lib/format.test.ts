// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatIntegration,
  formatExposureSeconds,
  formatTempC,
  formatGain,
  formatBinning,
} from './format';

describe('formatBytes', () => {
  it('formats byte counts across units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

// #631 — one formatter for integration time. Sessions rendered "1h 30m" while
// Projects rendered "1.5h" for the same quantity; these lock the single
// grammar both now share.
describe('formatIntegration', () => {
  it('renders hours and minutes together', () => {
    expect(formatIntegration(5400)).toBe('1h 30m');
    expect(formatIntegration(3661)).toBe('1h 1m');
  });

  it('drops the empty unit rather than padding with a zero', () => {
    expect(formatIntegration(7200)).toBe('2h');
    expect(formatIntegration(3000)).toBe('50m');
  });

  it('keeps whole minutes exact where the old "1.5h" rounded them away', () => {
    // 1.8h to one decimal — the divergent Projects formatter's output.
    expect(formatIntegration(6480)).toBe('1h 48m');
  });

  it('floors a nonzero sub-minute total to "<1m", never a misleading "0m"', () => {
    expect(formatIntegration(20)).toBe('<1m');
    expect(formatIntegration(59)).toBe('<1m');
  });

  it('uses the dash convention for absent and zero totals', () => {
    expect(formatIntegration(null)).toBe('—');
    expect(formatIntegration(undefined)).toBe('—');
    expect(formatIntegration(0)).toBe('—');
    expect(formatIntegration(-1)).toBe('—');
  });
});

// #811 — FITS-value formatters, extending lib/format.ts instead of the
// duplicated ad hoc versions in InboxDetail/MastersTable/MasterDetail.
describe('formatExposureSeconds', () => {
  it('rounds to 1 decimal and adds a space before the unit', () => {
    // Root cause of #789 — the raw unrounded float this replaces.
    expect(formatExposureSeconds(6.92447668013071)).toBe('6.9 s');
  });

  it('drops a trailing .0 for whole-number exposures', () => {
    expect(formatExposureSeconds(30)).toBe('30 s');
  });

  it('null-guards to the dash convention instead of "null"/"undefined"', () => {
    expect(formatExposureSeconds(null)).toBe('—');
    expect(formatExposureSeconds(undefined)).toBe('—');
  });
});

describe('formatTempC', () => {
  it('rounds to 1 decimal with a degree-C suffix', () => {
    expect(formatTempC(-10.449)).toBe('-10.4°C');
    expect(formatTempC(20)).toBe('20°C');
  });

  it('null-guards to the dash convention', () => {
    expect(formatTempC(null)).toBe('—');
  });
});

describe('formatGain', () => {
  it('stringifies a real gain value', () => {
    expect(formatGain(100)).toBe('100');
    expect(formatGain(0)).toBe('0');
  });

  it('null-guards instead of rendering the literal string "null"', () => {
    expect(formatGain(null)).toBe('—');
    expect(formatGain(undefined)).toBe('—');
  });
});

describe('formatBinning', () => {
  it('normalises the ascii "x" separator to "×"', () => {
    expect(formatBinning('2x2')).toBe('2×2');
    expect(formatBinning('1X1')).toBe('1×1');
  });

  it('null/empty-guards to the dash convention', () => {
    expect(formatBinning(null)).toBe('—');
    expect(formatBinning('')).toBe('—');
  });
});
