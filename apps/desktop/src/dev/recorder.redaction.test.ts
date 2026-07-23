// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Recorder redaction tests (spec 021 T019).
 *
 * Verifies that fields declared in `ContractMeta.sensitiveFields` and the
 * always-sensitive set (password/token/secret/api_key) are replaced with
 * `"<redacted>"` before storage in the ring buffer.
 *
 * Filesystem path redaction is also verified (spec 021 A-021-3).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  wrap,
  getCallSnapshot,
  resetRecorder,
  type DispatchFn,
} from './recorder';
import type { ContractMeta } from '@/bindings/index';

beforeEach(() => {
  resetRecorder();
});

function makeOkDispatch(): DispatchFn {
  return async () => ({ status: 'ok' });
}

function makeContracts(partial: Partial<ContractMeta> = {}): ContractMeta[] {
  return [
    {
      name: 'test.op',
      version: '1.0.0',
      schemaPath: '',
      direction: 'ui-to-core',
      replaySafe: false,
      sensitiveFields: [],
      ...partial,
    },
  ];
}

describe('recorder redaction (T019)', () => {
  it('redacts "password" from stored request', async () => {
    const dispatch = wrap(makeOkDispatch(), true, makeContracts());
    await dispatch('test.op', { password: 'hunter2', username: 'alice' });

    const req = getCallSnapshot()[0].request as Record<string, unknown>;
    expect(req.password).toBe('<redacted>');
    expect(req.username).toBe('alice');
  });

  it('redacts "token" from stored request', async () => {
    const dispatch = wrap(makeOkDispatch(), true, makeContracts());
    await dispatch('test.op', { token: 'tok_abc' });

    const req = getCallSnapshot()[0].request as Record<string, unknown>;
    expect(req.token).toBe('<redacted>');
  });

  it('redacts "secret" from stored request', async () => {
    const dispatch = wrap(makeOkDispatch(), true, makeContracts());
    await dispatch('test.op', { secret: 'mysecret' });

    const req = getCallSnapshot()[0].request as Record<string, unknown>;
    expect(req.secret).toBe('<redacted>');
  });

  it('redacts "api_key" from stored request', async () => {
    const dispatch = wrap(makeOkDispatch(), true, makeContracts());
    await dispatch('test.op', { api_key: 'key-xyz' });

    const req = getCallSnapshot()[0].request as Record<string, unknown>;
    expect(req.api_key).toBe('<redacted>');
  });

  it('redacts custom sensitiveFields declared in ContractMeta', async () => {
    const contracts = makeContracts({ sensitiveFields: ['customCredential'] });
    const dispatch = wrap(makeOkDispatch(), true, contracts);
    await dispatch('test.op', {
      customCredential: 'cred-123',
      safe: 'visible',
    });

    const req = getCallSnapshot()[0].request as Record<string, unknown>;
    expect(req.customCredential).toBe('<redacted>');
    expect(req.safe).toBe('visible');
  });

  it('preserves field name and shape when redacting (value replaced, key kept)', async () => {
    const dispatch = wrap(makeOkDispatch(), true, makeContracts());
    await dispatch('test.op', { password: 'secret', count: 5, active: true });

    const req = getCallSnapshot()[0].request as Record<string, unknown>;
    expect('password' in req).toBe(true);
    expect(req.password).toBe('<redacted>');
    expect(req.count).toBe(5);
    expect(req.active).toBe(true);
  });

  it('redacts nested sensitive fields', async () => {
    const dispatch = wrap(makeOkDispatch(), true, makeContracts());
    await dispatch('test.op', {
      auth: { token: 'nested-tok', type: 'bearer' },
    });

    const req = getCallSnapshot()[0].request as Record<string, unknown>;
    const auth = req.auth as Record<string, unknown>;
    expect(auth.token).toBe('<redacted>');
    expect(auth.type).toBe('bearer');
  });

  it('redacts Unix filesystem paths from request', async () => {
    const dispatch = wrap(makeOkDispatch(), true, makeContracts());
    await dispatch('test.op', {
      rootPath: '/home/user/astrophoto',
      label: 'NGC 7000',
    });

    const req = getCallSnapshot()[0].request as Record<string, unknown>;
    expect(req.rootPath).toBe('${PATH}');
    expect(req.label).toBe('NGC 7000');
  });

  it('redacts Windows filesystem paths from request', async () => {
    const dispatch = wrap(makeOkDispatch(), true, makeContracts());
    await dispatch('test.op', { path: 'D:\\Astrophotography\\Raw' });

    const req = getCallSnapshot()[0].request as Record<string, unknown>;
    expect(req.path).toBe('${PATH}');
  });

  it('does not redact non-sensitive, non-path fields', async () => {
    const dispatch = wrap(makeOkDispatch(), true, makeContracts());
    await dispatch('test.op', { target: 'NGC 7000', filter: 'Ha', count: 12 });

    const req = getCallSnapshot()[0].request as Record<string, unknown>;
    expect(req.target).toBe('NGC 7000');
    expect(req.filter).toBe('Ha');
    expect(req.count).toBe(12);
  });
});
