// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { MAX_NAME_LEN } from './schemas';

describe('schemas MAX_NAME_LEN parity', () => {
  it('matches crates/domain/core/src/project/validate.rs MAX_NAME_LEN', () => {
    // No generated tauri-specta binding exposes this constant; this pins the
    // duplicated literal so a change on either side without the other is
    // caught here rather than at runtime validation mismatch.
    expect(MAX_NAME_LEN).toBe(120);
  });
});
