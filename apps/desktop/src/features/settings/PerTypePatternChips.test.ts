// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unit tests for the per-type destination pattern parse/serialize utilities
 * introduced in spec 041 (chip-based editor iteration).
 *
 * parsePathPattern  — converts a path string → ordered PathChip[]
 * serializePathPattern — converts PathChip[] → path string (round-trip)
 *
 * These two functions form the codec between the backend wire format (a path
 * string like `masters/flats/{filter}/`) and the UI chip list.  Their
 * correctness is critical: a bug here would silently corrupt saved patterns.
 */

import { describe, expect, it } from 'vitest';
import type { PathChip } from './NamingStructure';
import { parsePathPattern, serializePathPattern } from './NamingStructure';

// Helper: extract only kind+value (strip generated ids for equality checks).
function stripped(chips: PathChip[]): { kind: string; value: string }[] {
  return chips.map(({ kind, value }) => ({ kind, value }));
}

describe('parsePathPattern', () => {
  it('empty string produces empty array', () => {
    expect(parsePathPattern('')).toEqual([]);
    expect(parsePathPattern('   ')).toEqual([]);
  });

  it('literal-only pattern: bias/', () => {
    expect(stripped(parsePathPattern('bias/'))).toEqual([
      { kind: 'literal', value: 'bias' },
      { kind: 'sep', value: '/' },
    ]);
  });

  it('token + sep: {target}/', () => {
    expect(stripped(parsePathPattern('{target}/'))).toEqual([
      { kind: 'token', value: 'target' },
      { kind: 'sep', value: '/' },
    ]);
  });

  it('default Light pattern: {target}/{filter}/{date}/light/', () => {
    expect(
      stripped(parsePathPattern('{target}/{filter}/{date}/light/')),
    ).toEqual([
      { kind: 'token', value: 'target' },
      { kind: 'sep', value: '/' },
      { kind: 'token', value: 'filter' },
      { kind: 'sep', value: '/' },
      { kind: 'token', value: 'date' },
      { kind: 'sep', value: '/' },
      { kind: 'literal', value: 'light' },
      { kind: 'sep', value: '/' },
    ]);
  });

  it('default MasterFlat pattern: masters/flats/{filter}/', () => {
    expect(stripped(parsePathPattern('masters/flats/{filter}/'))).toEqual([
      { kind: 'literal', value: 'masters' },
      { kind: 'sep', value: '/' },
      { kind: 'literal', value: 'flats' },
      { kind: 'sep', value: '/' },
      { kind: 'token', value: 'filter' },
      { kind: 'sep', value: '/' },
    ]);
  });

  it('default MasterDark pattern: masters/darks/{exposure}/', () => {
    expect(stripped(parsePathPattern('masters/darks/{exposure}/'))).toEqual([
      { kind: 'literal', value: 'masters' },
      { kind: 'sep', value: '/' },
      { kind: 'literal', value: 'darks' },
      { kind: 'sep', value: '/' },
      { kind: 'token', value: 'exposure' },
      { kind: 'sep', value: '/' },
    ]);
  });

  it('default Dark pattern: darks/{exposure}/', () => {
    expect(stripped(parsePathPattern('darks/{exposure}/'))).toEqual([
      { kind: 'literal', value: 'darks' },
      { kind: 'sep', value: '/' },
      { kind: 'token', value: 'exposure' },
      { kind: 'sep', value: '/' },
    ]);
  });

  it('pattern without trailing slash: flats/{filter}', () => {
    expect(stripped(parsePathPattern('flats/{filter}'))).toEqual([
      { kind: 'literal', value: 'flats' },
      { kind: 'sep', value: '/' },
      { kind: 'token', value: 'filter' },
    ]);
  });

  it('consecutive slashes produce consecutive sep chips', () => {
    // Edge case: // → two sep chips with nothing between them
    expect(stripped(parsePathPattern('//'))).toEqual([
      { kind: 'sep', value: '/' },
      { kind: 'sep', value: '/' },
    ]);
  });

  it('each chip gets a unique id', () => {
    const chips = parsePathPattern('flats/{filter}/');
    const ids = chips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('serializePathPattern', () => {
  it('empty array produces empty string', () => {
    expect(serializePathPattern([])).toBe('');
  });

  it('token chip serializes with braces', () => {
    const chips: PathChip[] = [{ id: 'a', kind: 'token', value: 'filter' }];
    expect(serializePathPattern(chips)).toBe('{filter}');
  });

  it('literal chip serializes as bare text', () => {
    const chips: PathChip[] = [{ id: 'a', kind: 'literal', value: 'flats' }];
    expect(serializePathPattern(chips)).toBe('flats');
  });

  it('sep chip serializes as /', () => {
    const chips: PathChip[] = [{ id: 'a', kind: 'sep', value: '/' }];
    expect(serializePathPattern(chips)).toBe('/');
  });

  it('mixed chips concatenate correctly', () => {
    const chips: PathChip[] = [
      { id: 'a', kind: 'literal', value: 'masters' },
      { id: 'b', kind: 'sep', value: '/' },
      { id: 'c', kind: 'literal', value: 'flats' },
      { id: 'd', kind: 'sep', value: '/' },
      { id: 'e', kind: 'token', value: 'filter' },
      { id: 'f', kind: 'sep', value: '/' },
    ];
    expect(serializePathPattern(chips)).toBe('masters/flats/{filter}/');
  });
});

describe('parsePathPattern ↔ serializePathPattern round-trip', () => {
  const DEFAULT_PATTERNS = [
    '{target}/{filter}/{date}/light/',
    'flats/{filter}/{date}/',
    'darks/{exposure}/',
    'bias/',
    'masters/flats/{filter}/',
    'masters/darks/{exposure}/',
    'masters/bias/',
  ];

  for (const pattern of DEFAULT_PATTERNS) {
    it(`round-trips: "${pattern}"`, () => {
      expect(serializePathPattern(parsePathPattern(pattern))).toBe(pattern);
    });
  }

  it('custom pattern round-trips: custom/{gain}/{date}/', () => {
    const pattern = 'custom/{gain}/{date}/';
    expect(serializePathPattern(parsePathPattern(pattern))).toBe(pattern);
  });

  it('pattern without trailing slash round-trips', () => {
    const pattern = 'flats/{filter}';
    expect(serializePathPattern(parsePathPattern(pattern))).toBe(pattern);
  });
});
