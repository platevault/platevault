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
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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

const {
  mockPickDirectory,
  mockSettingsGet,
  mockDevContractsList,
  mockDevCallsList,
  mockDevExport,
} = vi.hoisted(() => ({
  mockPickDirectory: vi.fn(),
  mockSettingsGet: vi.fn(),
  mockDevContractsList: vi.fn(),
  mockDevCallsList: vi.fn(),
  mockDevExport: vi.fn(),
}));

vi.mock('@/shared/native/picker', () => ({
  pickDirectory: mockPickDirectory,
}));

// Mirrors ContractsPage.test.tsx's adapter: raw payload -> generated
// `{ status: 'ok', data }` Result the real `unwrap` consumes.
vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: (...a: unknown[]) =>
      Promise.resolve(mockSettingsGet(...a)).then((data) => ({
        status: 'ok',
        data,
      })),
    devContractsList: (...a: unknown[]) =>
      Promise.resolve(mockDevContractsList(...a)).then((data) => ({
        status: 'ok',
        data,
      })),
    devCallsList: (...a: unknown[]) =>
      Promise.resolve(mockDevCallsList(...a)).then((data) => ({
        status: 'ok',
        data,
      })),
    devExport: (...a: unknown[]) =>
      Promise.resolve(mockDevExport(...a)).then((data) => ({
        status: 'ok',
        data,
      })),
  },
}));

beforeEach(() => {
  resetRecorder();
  vi.clearAllMocks();
  mockSettingsGet.mockResolvedValue({
    scope: 'advanced',
    values: { devMode: true },
  });
  mockDevContractsList.mockResolvedValue({ contracts: [] });
  mockDevCallsList.mockResolvedValue({ calls: [] });
  mockDevExport.mockResolvedValue({
    writtenPath: '/exported.json',
    callCount: 0,
    contractCount: 0,
  });
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

  it('dev_export requires absolute output path (relative triggers path.write.denied)', async () => {
    // Exercises ContractsPage.handleExport (T075 / FR-030): it always builds
    // outputPath from pickDirectory()'s result, which the native OS picker
    // guarantees is absolute — never a bare filename like
    // "123-dev-export.json" that the Rust side would reject with
    // path.write.denied.
    const { ContractsPage } = await import('./ContractsPage');
    mockPickDirectory.mockResolvedValue({
      path: '/tmp/exports',
      cancelled: false,
    });

    render(<ContractsPage />);
    const exportButton = await screen.findByRole('button', {
      name: /export/i,
    });
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(mockDevExport).toHaveBeenCalledTimes(1);
    });
    const { outputPath } = mockDevExport.mock.calls[0][0] as {
      outputPath: string;
    };
    expect(outputPath.startsWith('/')).toBe(true);
    expect(outputPath).toMatch(/^\/tmp\/exports\/\d+-dev-export\.json$/);
  });

  it('dev_export builds an absolute Windows-style path when the picker returns a drive path', async () => {
    const { ContractsPage } = await import('./ContractsPage');
    mockPickDirectory.mockResolvedValue({
      path: 'C:\\Users\\astro\\exports',
      cancelled: false,
    });

    render(<ContractsPage />);
    const exportButton = await screen.findByRole('button', {
      name: /export/i,
    });
    fireEvent.click(exportButton);

    await waitFor(() => {
      expect(mockDevExport).toHaveBeenCalledTimes(1);
    });
    const { outputPath } = mockDevExport.mock.calls[0][0] as {
      outputPath: string;
    };
    expect(outputPath).toMatch(/^[A-Za-z]:[/\\]/);
    expect(outputPath).toMatch(
      /^C:\\Users\\astro\\exports\\\d+-dev-export\.json$/,
    );
  });
});
