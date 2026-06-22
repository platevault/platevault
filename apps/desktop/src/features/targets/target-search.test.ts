/**
 * target-search.test.ts — alias-aware search normalization (#103b, spec-043).
 *
 * Validates that normalizeDesig collapses whitespace and folds case, and that
 * matchesSearch matches "M31", "M 31", and "Andromeda" to the same target.
 */

import { describe, it, expect } from 'vitest';
import type { TargetListItem } from '@/api/commands';
import { normalizeDesig, matchesSearch } from './TargetsPage';

function item(
  primaryDesignation: string,
  effectiveLabel?: string,
  objectType = 'other',
): TargetListItem {
  return {
    id: primaryDesignation,
    effectiveLabel: effectiveLabel ?? primaryDesignation,
    primaryDesignation,
    objectType,
  };
}

describe('normalizeDesig', () => {
  it('lowercases the string', () => {
    expect(normalizeDesig('M 31')).toBe('m31');
    expect(normalizeDesig('NGC 7000')).toBe('ngc7000');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeDesig('M 31')).toBe(normalizeDesig('M31'));
    expect(normalizeDesig('NGC  7000')).toBe(normalizeDesig('NGC7000'));
  });

  it('handles leading/trailing whitespace', () => {
    expect(normalizeDesig('  M 31  ')).toBe('m31');
  });

  it('preserves non-whitespace characters', () => {
    expect(normalizeDesig('Sh2-155')).toBe('sh2-155');
  });
});

describe('matchesSearch — alias-aware (#103b)', () => {
  const m31 = item('M 31', 'Andromeda Galaxy', 'galaxy');
  const ngc7000 = item('NGC 7000', 'North America Nebula', 'emission_nebula');

  // Compact (no-space) form matches spaced designation
  it('"M31" matches target with primaryDesignation "M 31"', () => {
    expect(matchesSearch(m31, 'M31')).toBe(true);
  });

  it('"m31" matches "M 31" (case-insensitive + whitespace-insensitive)', () => {
    expect(matchesSearch(m31, 'm31')).toBe(true);
  });

  it('"M 31" matches "M 31" directly', () => {
    expect(matchesSearch(m31, 'M 31')).toBe(true);
  });

  // Proper-name substring matching
  it('"Andromeda" matches effectiveLabel "Andromeda Galaxy"', () => {
    expect(matchesSearch(m31, 'Andromeda')).toBe(true);
  });

  it('"andromeda" case-insensitive matches "Andromeda Galaxy"', () => {
    expect(matchesSearch(m31, 'andromeda')).toBe(true);
  });

  // NGC spaced/compact
  it('"NGC7000" matches target with primaryDesignation "NGC 7000"', () => {
    expect(matchesSearch(ngc7000, 'NGC7000')).toBe(true);
  });

  it('"ngc7000" matches "NGC 7000" (case + whitespace insensitive)', () => {
    expect(matchesSearch(ngc7000, 'ngc7000')).toBe(true);
  });

  // Non-matches
  it('"M31" does NOT match "NGC 7000"', () => {
    expect(matchesSearch(ngc7000, 'M31')).toBe(false);
  });

  it('"Andromeda" does NOT match "NGC 7000" or its label', () => {
    expect(matchesSearch(ngc7000, 'Andromeda')).toBe(false);
  });

  // Partial prefix matching
  it('"NGC" matches "NGC 7000" by prefix', () => {
    expect(matchesSearch(ngc7000, 'NGC')).toBe(true);
  });

  it('"North America" matches effectiveLabel "North America Nebula"', () => {
    expect(matchesSearch(ngc7000, 'North America')).toBe(true);
  });
});
