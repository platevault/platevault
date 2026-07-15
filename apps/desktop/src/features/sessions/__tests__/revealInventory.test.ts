// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * revealInventoryPath command-wiring test — spec 006 FR-007 (T411).
 *
 * The Sessions/Inventory row Reveal action must invoke the spec-004
 * native reveal command (`native.reveal`) with the row's resolved source path
 * and an `inventory_row` audit tag.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockNativeReveal } = vi.hoisted(() => ({
  mockNativeReveal: vi.fn(),
}));

// Mock the generated bindings surface and the ipc unwrap so we assert exactly
// what revealInventoryPath forwards to the native command.
vi.mock('@/bindings/index', () => ({
  commands: { nativeReveal: mockNativeReveal },
}));

vi.mock('@/api/ipc', () => ({
  invoke: vi.fn(),
  unwrap: <T>(r: { status: string; data?: T; error?: unknown }) => {
    if (r.status === 'error') throw r.error;
    return r.data as T;
  },
  setInvokeOverride: vi.fn(),
}));

import {
  revealInventoryPath,
  resolveRevealPath,
} from '@/features/sessions/revealInventory';

interface RevealArg {
  requestId: string;
  path: string;
  entityKind: string | null;
  entityId: string | null;
}

const firstCallArg = (): RevealArg =>
  mockNativeReveal.mock.calls[0][0] as RevealArg;

describe('revealInventoryPath (spec 006 FR-007)', () => {
  beforeEach(() => {
    mockNativeReveal.mockReset();
    mockNativeReveal.mockResolvedValue({
      status: 'ok',
      data: { revealed: true, selection: 'file' },
    });
  });

  it('invokes native reveal with the given path and an inventory_row audit tag', async () => {
    await revealInventoryPath({
      path: '/mnt/lib/NGC7000',
      sessionId: 'ses-42',
    });

    expect(mockNativeReveal).toHaveBeenCalledTimes(1);
    const arg = firstCallArg();
    expect(arg.path).toBe('/mnt/lib/NGC7000');
    expect(arg.entityKind).toBe('inventory_row');
    expect(arg.entityId).toBe('ses-42');
    expect(typeof arg.requestId).toBe('string');
  });

  it('passes a null entityId when no sessionId is supplied', async () => {
    await revealInventoryPath({ path: '/mnt/lib/M31' });
    const arg = firstCallArg();
    expect(arg.path).toBe('/mnt/lib/M31');
    expect(arg.entityId).toBeNull();
  });

  it('propagates a native reveal error (rejects) for the caller to toast', async () => {
    mockNativeReveal.mockResolvedValue({
      status: 'error',
      error: { code: 'path.not_exists' },
    });
    await expect(revealInventoryPath({ path: '/gone' })).rejects.toBeDefined();
  });
});

describe('resolveRevealPath (#567)', () => {
  it('joins the POSIX root with the session frame folder', () => {
    expect(resolveRevealPath('/mnt/lib/SessionMatrix', 'Lights/M 51/L')).toBe(
      '/mnt/lib/SessionMatrix/Lights/M 51/L',
    );
  });

  it('joins with the native separator for a Windows root', () => {
    expect(
      resolveRevealPath(
        'D:\\Astrophotography\\SessionMatrix',
        'Lights\\M 51\\2025-05-03\\L',
      ),
    ).toBe('D:\\Astrophotography\\SessionMatrix\\Lights\\M 51\\2025-05-03\\L');
  });

  it('collapses a trailing root separator and a leading relative separator', () => {
    expect(resolveRevealPath('/mnt/lib/', '/Lights/L')).toBe(
      '/mnt/lib/Lights/L',
    );
  });

  it('falls back to the root when relativePath is null or empty', () => {
    expect(resolveRevealPath('/mnt/lib', null)).toBe('/mnt/lib');
    expect(resolveRevealPath('/mnt/lib', undefined)).toBe('/mnt/lib');
    expect(resolveRevealPath('/mnt/lib', '')).toBe('/mnt/lib');
  });
});
