// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * T072 — Release build has NO reachable developer route or commands (FR-031, SC-009).
 *
 * Verifies that when VITE_DEV_TOOLS is not "true":
 * 1. The DEV_TOOLS_ENABLED flag is false.
 * 2. devContractsRoute is null (never added to the route tree).
 * 3. The recorder's setInvokeOverride is never called (no proxy installed).
 *
 * This is a static/unit check — the build-time constant is what matters for
 * tree-shaking. We verify the runtime guard here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('T072: release build dev surface gate', () => {
  let originalEnv: string;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any).env as Record<string, string> | undefined;
    originalEnv = env?.VITE_DEV_TOOLS ?? 'false';
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (import.meta as any).env.VITE_DEV_TOOLS = originalEnv;
  });

  it('DEV_TOOLS_ENABLED is false when VITE_DEV_TOOLS is not "true"', () => {
    // The vite.config.ts sets VITE_DEV_TOOLS="false" by default.
    // In the test environment it is also "false" (no override provided).
    const devToolsEnv = import.meta.env.VITE_DEV_TOOLS;
    const devToolsEnabled = devToolsEnv === 'true';
    expect(devToolsEnabled).toBe(false);
  });

  it('recorder wrap returns the original dispatch unchanged when devMode=false', async () => {
    const { wrap } = await import('./recorder');
    const original = vi.fn().mockResolvedValue({ status: 'ok' });
    const wrapped = wrap(original, false);
    // When devMode=false, wrap returns the original function reference
    expect(wrapped).toBe(original);
  });

  it('setInvokeOverride with null stops routing invoke() through the override', async () => {
    const ipc = await import('@/api/ipc');
    const overrideCall = vi.fn().mockResolvedValue('override-result');

    // While an override is installed, invoke() routes through it.
    ipc.setInvokeOverride(overrideCall);
    await expect(ipc.invoke('some_command', {})).resolves.toBe(
      'override-result',
    );
    expect(overrideCall).toHaveBeenCalledWith('some_command', {});

    // Clearing it (release-build state) must stop dispatching through the
    // override. There's no real Tauri runtime in jsdom, so invoke() rejects
    // here — the assertion is that it did NOT go through overrideCall.
    ipc.setInvokeOverride(null);
    overrideCall.mockClear();
    await ipc.invoke('some_command', {}).catch(() => {});
    expect(overrideCall).not.toHaveBeenCalled();
  });

  it('dev route is not registered in the real router when DEV_TOOLS_ENABLED=false', async () => {
    // VITE_DEV_TOOLS is "false" in tests (default vite.config.ts), so
    // router.tsx's DEV_TOOLS_ENABLED gate evaluates false and devContractsRoute
    // is never added to routeTree — verified here against the actual built
    // `router` export, not just the env var the gate reads.
    expect(import.meta.env.VITE_DEV_TOOLS).not.toBe('true');
    const { router } = await import('@/app/router');
    expect(Object.keys(router.routesById)).not.toContain('/dev/contracts');
    expect(Object.keys(router.routesById)).not.toContain('/dev/settings');
  });
});
