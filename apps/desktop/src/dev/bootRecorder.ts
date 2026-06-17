/**
 * bootRecorder — installs the recording proxy at app boot (spec 021 / T075 / SC-002).
 *
 * Called from main.tsx only in dev-tools builds (VITE_DEV_TOOLS="true").
 * Checks the backend `devMode` setting; if on, wraps the shared Tauri
 * dispatcher so every IPC call is captured into the ring buffer automatically.
 *
 * Release builds: this entire module is dead code (the calling `if` in
 * main.tsx is statically false when VITE_DEV_TOOLS="false").
 */

import type { DispatchFn } from './recorder';
import { setInvokeOverride } from '@/api/commands';
import { getSettings } from '@/api/commands';

/**
 * installRecorder — called from main.tsx with the `wrap` function from recorder.ts.
 * Queries devMode from backend settings and installs the proxy if enabled.
 */
export async function installRecorder(
  wrap: (dispatch: DispatchFn, devMode: boolean, contracts?: import('@/api/commands').ContractMeta[]) => DispatchFn,
): Promise<void> {
  try {
    const settings = await getSettings({ scope: 'advanced' });
    const vals = settings.values as Record<string, unknown>;
    const devMode = vals?.devMode === true;

    if (!devMode) return;

    // Build the real Tauri dispatch function as the base.
    const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
    const baseDispatch: DispatchFn = (cmd, args) =>
      tauriInvoke<unknown>(cmd, args as Record<string, unknown>);

    const wrapped = wrap(baseDispatch, true, []);
    setInvokeOverride(wrapped);
  } catch {
    // Backend unavailable at boot (e.g. first launch) — skip proxy installation.
  }
}
