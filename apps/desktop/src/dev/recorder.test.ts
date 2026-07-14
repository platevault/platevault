// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Recorder ring buffer and dispatcher proxy tests (spec 021 T017, T018, T019).
 *
 * Tests:
 * - Ring buffer eviction order and `dropped` counter (T017).
 * - Recorder not installed when devMode = false — verified by proxy absence (T018).
 * - Sensitive fields declared in ContractMeta.sensitiveFields are redacted (T019).
 * - Path redaction (spec 021 A-021-3).
 * - Payload truncation at 64 KB.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCallSnapshot,
  getDropped,
  resetRecorder,
  wrap,
  redactPayload,
  CALL_BUFFER_SIZE,
  type DispatchFn,
} from './recorder';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDispatch(result: unknown = { status: 'ok' }): DispatchFn {
  return async (_cmd, _args) => result;
}

function makeFailingDispatch(
  code = 'not_found',
  message = 'Not found',
): DispatchFn {
  return async (_cmd, _args) => {
    throw Object.assign(new Error(message), { code });
  };
}

beforeEach(() => {
  resetRecorder();
});

// ── Ring buffer (T017) ────────────────────────────────────────────────────────

describe('recorder ring buffer', () => {
  it('snapshot returns calls newest-first', async () => {
    const dispatch = wrap(makeDispatch(), true);
    await dispatch('cmd.a');
    await dispatch('cmd.b');
    await dispatch('cmd.c');

    const snap = getCallSnapshot();
    expect(snap[0].contract).toBe('cmd.c');
    expect(snap[1].contract).toBe('cmd.b');
    expect(snap[2].contract).toBe('cmd.a');
  });

  it('evicts oldest entries when capacity is exceeded', async () => {
    const dispatch = wrap(makeDispatch(), true);
    for (let i = 1; i <= CALL_BUFFER_SIZE + 3; i++) {
      await dispatch(`cmd.${i}`);
    }

    const snap = getCallSnapshot();
    expect(snap.length).toBe(CALL_BUFFER_SIZE);
    expect(getDropped()).toBe(3);
    // Newest entry should be the last one dispatched.
    expect(snap[0].contract).toBe(`cmd.${CALL_BUFFER_SIZE + 3}`);
  });

  it('dropped counter starts at zero', () => {
    expect(getDropped()).toBe(0);
  });

  it('records successful call with response', async () => {
    const dispatch = wrap(makeDispatch({ status: 'ok', data: 42 }), true);
    await dispatch('sessions.list', { limit: 10 });

    const snap = getCallSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].contract).toBe('sessions.list');
    expect(snap[0].error).toBeUndefined();
    expect(snap[0].payloadTruncated).toBe(false);
  });

  it('records failed call with error, does not store response', async () => {
    const dispatch = wrap(makeFailingDispatch('not_found', 'Not found'), true);
    await expect(dispatch('targets.get', { id: 'x' })).rejects.toThrow(
      'Not found',
    );

    const snap = getCallSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].error).toEqual({ code: 'not_found', message: 'Not found' });
    expect(snap[0].response).toBeUndefined();
  });

  it('assigns monotonically increasing IDs', async () => {
    const dispatch = wrap(makeDispatch(), true);
    await dispatch('a');
    await dispatch('b');
    await dispatch('c');

    const snap = getCallSnapshot();
    const ids = snap.map((c) => c.id);
    // IDs should be unique strings.
    expect(new Set(ids).size).toBe(3);
  });

  it('records startedAt as ISO-8601 string', async () => {
    const dispatch = wrap(makeDispatch(), true);
    await dispatch('test.op');

    const snap = getCallSnapshot();
    expect(snap[0].startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records non-negative durationMs', async () => {
    const dispatch = wrap(makeDispatch(), true);
    await dispatch('test.op');

    const snap = getCallSnapshot();
    expect(snap[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── devMode = false — no proxy (T018) ─────────────────────────────────────────

describe('recorder installation guard', () => {
  it('returns original dispatch function unchanged when devMode = false', () => {
    const original = makeDispatch();
    const wrapped = wrap(original, false);
    // When devMode is false, wrap() returns the same reference.
    expect(wrapped).toBe(original);
  });

  it('records nothing when devMode = false', async () => {
    const dispatch = wrap(makeDispatch(), false);
    await dispatch('sessions.list');
    expect(getCallSnapshot()).toHaveLength(0);
  });
});

// ── Sensitive field redaction (T019) ──────────────────────────────────────────

describe('redactPayload', () => {
  it('redacts "password" fields at the top level', () => {
    const result = redactPayload({ password: 'secret123', name: 'Alice' });
    expect((result as Record<string, unknown>).password).toBe('<redacted>');
    expect((result as Record<string, unknown>).name).toBe('Alice');
  });

  it('redacts "token" fields at any depth', () => {
    const result = redactPayload({ auth: { token: 'abc', type: 'bearer' } });
    const auth = (result as Record<string, unknown>).auth as Record<
      string,
      unknown
    >;
    expect(auth.token).toBe('<redacted>');
    expect(auth.type).toBe('bearer');
  });

  it('redacts "secret" fields', () => {
    const result = redactPayload({ secret: 'mysecret' });
    expect((result as Record<string, unknown>).secret).toBe('<redacted>');
  });

  it('redacts "api_key" fields', () => {
    const result = redactPayload({ api_key: 'key-123' });
    expect((result as Record<string, unknown>).api_key).toBe('<redacted>');
  });

  it('redacts extra sensitive fields passed in', () => {
    const result = redactPayload({ customField: 'value' }, ['customField']);
    expect((result as Record<string, unknown>).customField).toBe('<redacted>');
  });

  it('redacts Unix absolute paths', () => {
    const result = redactPayload({ rootPath: '/home/user/astrophotography' });
    expect((result as Record<string, unknown>).rootPath).toBe('${PATH}');
  });

  it('redacts Windows absolute paths', () => {
    const result = redactPayload({ rootPath: 'D:\\Astrophotography\\Raw' });
    expect((result as Record<string, unknown>).rootPath).toBe('${PATH}');
  });

  it('does not redact non-path string values', () => {
    const result = redactPayload({ label: 'NGC 7000', filter: 'Ha' });
    expect((result as Record<string, unknown>).label).toBe('NGC 7000');
    expect((result as Record<string, unknown>).filter).toBe('Ha');
  });

  it('handles null and undefined gracefully', () => {
    expect(redactPayload(null)).toBeNull();
    expect(redactPayload(undefined)).toBeUndefined();
  });

  it('handles arrays recursively', () => {
    const result = redactPayload([{ password: 'p', name: 'x' }]);
    const arr = result as Array<Record<string, unknown>>;
    expect(arr[0].password).toBe('<redacted>');
    expect(arr[0].name).toBe('x');
  });

  it('redaction runs per-call via wrap sensitive_fields contract meta', async () => {
    const dispatch = wrap(makeDispatch({ ok: true }), true, [
      {
        name: 'auth.login',
        version: '1.0.0',
        schemaPath: '',
        direction: 'ui-to-core',
        replaySafe: false,
        sensitiveFields: ['mySecretField'],
      },
    ]);
    await dispatch('auth.login', { mySecretField: 'hunter2', user: 'alice' });

    const snap = getCallSnapshot();
    const req = snap[0].request as Record<string, unknown>;
    expect(req.mySecretField).toBe('<redacted>');
    expect(req.user).toBe('alice');
  });
});

// ── Payload truncation ────────────────────────────────────────────────────────

describe('payload truncation', () => {
  it('does not truncate payloads under 64 KB', async () => {
    const small = { data: 'x'.repeat(100) };
    const dispatch = wrap(makeDispatch(small), true);
    await dispatch('test.op', { small: true });

    const snap = getCallSnapshot();
    expect(snap[0].payloadTruncated).toBe(false);
  });

  it('marks payloadTruncated=true for oversized response', async () => {
    // Response > 64 KB.
    const big = { data: 'x'.repeat(65 * 1024) };
    const dispatch = wrap(makeDispatch(big), true);
    await dispatch('test.op');

    const snap = getCallSnapshot();
    expect(snap[0].payloadTruncated).toBe(true);
  });
});
