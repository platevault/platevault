// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { isProtectedLevel, protectionLabel } from './protection-label';

describe('protectionLabel (issue #801)', () => {
  it('labels the protected level', () => {
    expect(protectionLabel('protected')).toBe('Protected');
  });

  it('labels the unprotected level', () => {
    expect(protectionLabel('unprotected')).toBe('Unprotected');
  });

  it('never echoes an unrecognized backend string back to the user', () => {
    // The regression #801 filed: cleanup tables printed `c.protection` raw.
    for (const raw of ['normal', 'NOT_PROTECTED', '', 'wat']) {
      expect(protectionLabel(raw)).not.toBe(raw);
    }
  });

  it('collapses unknown values to unprotected, mirroring parse_level', () => {
    expect(protectionLabel('normal')).toBe('Unprotected');
  });

  it('isProtectedLevel matches only the exact protected value', () => {
    expect(isProtectedLevel('protected')).toBe(true);
    expect(isProtectedLevel('unprotected')).toBe(false);
    expect(isProtectedLevel(null)).toBe(false);
    expect(isProtectedLevel(undefined)).toBe(false);
  });
});
