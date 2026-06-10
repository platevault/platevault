/**
 * Spec 020 — route-contract parser + validateSearch tests (T050, T051, T054).
 */
import { describe, it, expect } from 'vitest';
import {
  parseNumber,
  parseString,
  parseEnum,
  parseCsvEnum,
  makeValidateSearch,
  FRAME_TYPES,
  PROJECT_STATES,
} from '@/lib/route-contract';

describe('parseNumber (T050)', () => {
  it('accepts finite numbers and numeric strings', () => {
    expect(parseNumber(3)).toBe(3);
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber(0)).toBe(0);
  });
  it('rejects non-numeric, empty, NaN, and nullish input', () => {
    expect(parseNumber('abc')).toBeUndefined();
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('   ')).toBeUndefined();
    expect(parseNumber(Number.NaN)).toBeUndefined();
    expect(parseNumber(undefined)).toBeUndefined();
    expect(parseNumber(null)).toBeUndefined();
    expect(parseNumber({})).toBeUndefined();
  });
});

describe('parseEnum (T050)', () => {
  const p = parseEnum(FRAME_TYPES);
  it('keeps allow-listed values', () => {
    expect(p('light')).toBe('light');
    expect(p('bias')).toBe('bias');
  });
  it('drops values outside the allow-list or of the wrong type', () => {
    expect(p('plasma')).toBeUndefined();
    expect(p(5)).toBeUndefined();
    expect(p(undefined)).toBeUndefined();
  });
});

describe('parseCsvEnum (T050)', () => {
  const p = parseCsvEnum(PROJECT_STATES);
  it('parses a comma list, keeping only allow-listed members', () => {
    expect(p('processing,archived')).toEqual(['processing', 'archived']);
    expect(p('processing, completed')).toEqual(['processing', 'completed']);
  });
  it('drops members not in the allow-list', () => {
    expect(p('processing,bogus')).toEqual(['processing']);
  });
  it('returns undefined when nothing valid remains', () => {
    expect(p('bogus')).toBeUndefined();
    expect(p('')).toBeUndefined();
    expect(p(7)).toBeUndefined();
  });
});

describe('makeValidateSearch (T051)', () => {
  const validate = makeValidateSearch({
    selected: parseNumber,
    lifecycle: parseCsvEnum(PROJECT_STATES),
  });

  it('drops unknown keys (forward-compat for older links)', () => {
    expect(validate({ selected: '3', junk: 'x', stale: 'y' })).toEqual({ selected: 3 });
  });

  it('coerces invalid values of known keys away (omits them)', () => {
    expect(validate({ selected: 'abc' })).toEqual({});
    expect(validate({ lifecycle: 'nope' })).toEqual({});
  });

  it('returns a clean object when no params are present', () => {
    expect(validate({})).toEqual({});
  });
});

describe('special-character round-trip (T054)', () => {
  // validateSearch receives already-decoded values; the contract layer must
  // preserve them verbatim so encode -> decode round-trips unchanged.
  const validate = makeValidateSearch({ q: parseString, lifecycle: parseCsvEnum(PROJECT_STATES) });

  it('preserves spaces, plus, and commas inside a string value', () => {
    expect(validate({ q: 'a, b +c' })).toEqual({ q: 'a, b +c' });
  });

  it('splits a comma-list the same way regardless of surrounding spaces', () => {
    expect(validate({ lifecycle: ' processing , archived ' })).toEqual({
      lifecycle: ['processing', 'archived'],
    });
  });
});
