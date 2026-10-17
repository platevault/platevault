// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, vi } from 'vitest';
import { errMessage, isContractError } from './errors';
import { errorFallback } from './error-messages';
import { m } from '@/lib/i18n';

describe('errMessage (spec 046 US2 — single translation point)', () => {
  it('maps a known ContractError code to its friendly catalog message', () => {
    const msg = errMessage({
      code: 'path.not_exists',
      message: 'ENOENT raw backend text',
    });
    expect(msg).toBe(m.err_path_not_exists());
  });

  it('never shows the raw code or the raw backend message for a ContractError (FR-009)', () => {
    const raw = 'sqlite: disk I/O error at 0xdeadbeef';
    const msg = errMessage({ code: 'internal.database', message: raw });
    expect(msg).not.toBe(raw);
    expect(msg).not.toContain('internal.database');
    expect(msg).toBe(m.err_internal_database());
  });

  it('falls back to the generic message AND logs an unmapped/unknown code (FR-010/FR-011)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const msg = errMessage({ code: 'totally.unknown.code', message: 'raw' });
    expect(msg).toBe(errorFallback());
    expect(msg).not.toContain('totally.unknown.code');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('totally.unknown.code'),
    );
    spy.mockRestore();
  });

  it('preserves a native Error message', () => {
    expect(errMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies any other thrown value (never "[object Object]")', () => {
    expect(errMessage('plain string')).toBe('plain string');
    expect(errMessage(42)).toBe('42');
  });
});

describe('errMessage for an export that left its own incomplete file', () => {
  const unfinished = (details: unknown) => ({
    code: 'export.unfinished_file',
    message: 'raw',
    details,
  });

  it('names the path the backend reports in details.path', () => {
    const msg = errMessage(
      unfinished({ path: '/Volumes/STICK/real/log.json' }),
    );
    expect(msg).toBe(
      m.err_export_unfinished_file_at({ path: '/Volumes/STICK/real/log.json' }),
    );
    expect(msg).toContain('/Volumes/STICK/real/log.json');
  });

  it('falls back to the path-free wording when details carry no usable path', () => {
    for (const details of [undefined, null, {}, { path: 42 }, { path: '' }]) {
      expect(errMessage(unfinished(details))).toBe(
        m.err_export_unfinished_file(),
      );
    }
  });
});

describe('isContractError', () => {
  it('recognises a { code, message } shape', () => {
    expect(isContractError({ code: 'x', message: 'y' })).toBe(true);
    expect(isContractError(new Error('no'))).toBe(false);
    expect(isContractError(null)).toBe(false);
  });
});
