// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  formatBytes,
  formatIntegration,
  formatIntegrationHours,
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

describe('formatIntegration', () => {
  it('formats seconds into h/m/s', () => {
    expect(formatIntegration(3661)).toBe('1h 1m 1s');
    expect(formatIntegration(0)).toBe('0s');
  });
});

describe('formatIntegrationHours', () => {
  it('formats hours to one decimal', () => {
    expect(formatIntegrationHours(2.5)).toBe('2.5h');
    expect(formatIntegrationHours(0)).toBe('0h');
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
