/**
 * target-search.test.ts — alias-aware search normalization (#103b, #29, spec-043).
 *
 * Validates that normalizeDesig collapses whitespace and folds case, and that
 * matchesSearch matches "M31", "M 31", and "Andromeda" to the same target —
 * including via the `aliases` array now carried on every TargetListItem
 * (backend task #29, alias enrichment).
 */

import { describe, it, expect } from 'vitest';
import type { TargetListItem } from '@/bindings/index';
import { normalizeDesig, matchesSearch } from './TargetsPage';

function item(
  primaryDesignation: string,
  effectiveLabel?: string,
  objectType = 'other',
  aliases: string[] = [],
): TargetListItem {
  return {
    id: primaryDesignation,
    effectiveLabel: effectiveLabel ?? primaryDesignation,
    primaryDesignation,
    objectType,
    raDeg: 0,
    decDeg: 0,
    aliases,
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

describe('matchesSearch — designation + label (#103b)', () => {
  // effectiveLabel is the bare designation; aliases carry the proper names.
  const m31 = item('M 31', 'Andromeda Galaxy', 'galaxy', [
    'M 31',
    'NGC 224',
    'Andromeda Galaxy',
  ]);
  const ngc7000 = item('NGC 7000', 'North America Nebula', 'emission_nebula', [
    'NGC 7000',
    'North America Nebula',
  ]);

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

  // Proper-name substring matching via effectiveLabel
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

describe('matchesSearch — alias array (#29)', () => {
  // Key scenario: effectiveLabel is the bare designation ("M 31"), but the
  // aliases array carries "Andromeda Galaxy". The search must still resolve.
  const m31DesigLabel = item('M 31', 'M 31', 'galaxy', [
    'M 31',
    'NGC 224',
    'Andromeda Galaxy',
  ]);

  it('"Andromeda" resolves to M31 via aliases when effectiveLabel is bare designation', () => {
    expect(matchesSearch(m31DesigLabel, 'Andromeda')).toBe(true);
  });

  it('"andromeda galaxy" case-insensitive matches alias', () => {
    expect(matchesSearch(m31DesigLabel, 'andromeda galaxy')).toBe(true);
  });

  it('"NGC 224" alternate designation matches via aliases', () => {
    expect(matchesSearch(m31DesigLabel, 'NGC 224')).toBe(true);
  });

  it('"ngc224" compact form matches alias "NGC 224" via normalization', () => {
    expect(matchesSearch(m31DesigLabel, 'ngc224')).toBe(true);
  });

  it('"Pinwheel" does NOT match M31 aliases', () => {
    expect(matchesSearch(m31DesigLabel, 'Pinwheel')).toBe(false);
  });

  // Empty aliases array — graceful no-op (no crash, no false match).
  const bare = item('IC 1805', 'IC 1805', 'emission_nebula', []);
  it('empty aliases array does not crash and does not produce false matches', () => {
    expect(matchesSearch(bare, 'Andromeda')).toBe(false);
    expect(matchesSearch(bare, 'IC 1805')).toBe(true);
  });

  // Missing aliases field (undefined) — graceful fallback via `?? []`.
  const noAliasField = {
    id: 'x',
    effectiveLabel: 'M 42',
    primaryDesignation: 'M 42',
    objectType: 'emission_nebula',
    raDeg: 0,
    decDeg: 0,
  } as TargetListItem;
  it('absent aliases field does not crash (nullish coalesce guard)', () => {
    expect(matchesSearch(noAliasField, 'Orion')).toBe(false);
    expect(matchesSearch(noAliasField, 'M 42')).toBe(true);
  });
});
