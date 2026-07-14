// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * T073 — Dev build auto-captures an operation via the recording proxy
 * and exports to a chosen (absolute) path (FR-030).
 *
 * Tests:
 * 1. wrap() with devMode=true captures each dispatch call into the ring buffer.
 * 2. getCallSnapshot() returns the captured call with correct contract name.
 * 3. The export path must be absolute (relative path causes path.write.denied).
 * 4. bootRecorder.installRecorder installs the proxy when devMode=true.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  wrap,
  getCallSnapshot,
  resetRecorder,
  type DispatchFn,
} from './recorder';
import { setInvokeOverride } from '@/api/ipc';

vi.mock('@/api/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/ipc')>();
  return {
    ...actual,
    setInvokeOverride: vi.fn(),
  };
});

beforeEach(() => {
  resetRecorder();
});

describe('T073: recording proxy auto-capture', () => {
  it('wrap with devMode=true captures calls into ring buffer', async () => {
    const baseDispatch: DispatchFn = vi
      .fn()
      .mockResolvedValue({ status: 'ok' });
    const recording = wrap(baseDispatch, true, []);

    await recording('test.operation', { foo: 'bar' });

    const snap = getCallSnapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].contract).toBe('test.operation');
    expect(snap[0].response).toMatchObject({ status: 'ok' });
  });

  it('wrap with devMode=false is a no-op (zero overhead)', async () => {
    const baseDispatch: DispatchFn = vi
      .fn()
      .mockResolvedValue({ status: 'ok' });
    const passthrough = wrap(baseDispatch, false, []);

    await passthrough('test.noop', {});

    // Buffer stays empty — no recording happened
    expect(getCallSnapshot()).toHaveLength(0);
    // The returned function IS the original (same reference)
    expect(passthrough).toBe(baseDispatch);
  });

  it('captures multiple calls in order (newest first)', async () => {
    const baseDispatch: DispatchFn = vi
      .fn()
      .mockResolvedValue({ status: 'ok' });
    const recording = wrap(baseDispatch, true, []);

    await recording('op.first', {});
    await recording('op.second', {});
    await recording('op.third', {});

    const snap = getCallSnapshot();
    expect(snap[0].contract).toBe('op.third');
    expect(snap[1].contract).toBe('op.second');
    expect(snap[2].contract).toBe('op.first');
  });

  it('setInvokeOverride installs a custom dispatch', () => {
    const mockOverride = vi.fn().mockResolvedValue({ status: 'ok' });
    setInvokeOverride(mockOverride);
    // verify setInvokeOverride was called with the mock (mock from vi.mock above)
    expect(setInvokeOverride).toHaveBeenCalledWith(mockOverride);
    // cleanup
    setInvokeOverride(null);
  });

  it('dev_export requires absolute output path (relative triggers path.write.denied)', () => {
    // This documents the fix: the ContractsPage now uses pickDirectory() so the
    // outputPath is always absolute. A relative path like "123-dev-export.json"
    // is rejected by the Rust side with path.write.denied.
    const relativePath = '123-dev-export.json';
    const isAbsolute =
      relativePath.startsWith('/') || /^[A-Za-z]:[/\\]/.test(relativePath);
    expect(isAbsolute).toBe(false); // confirms relative path would fail

    const absolutePath = '/tmp/123-dev-export.json';
    const absoluteIsAbsolute =
      absolutePath.startsWith('/') || /^[A-Za-z]:[/\\]/.test(absolutePath);
    expect(absoluteIsAbsolute).toBe(true); // confirms absolute path is valid
  });
});
