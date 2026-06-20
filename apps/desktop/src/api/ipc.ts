/**
 * Single IPC dispatch point (spec 037).
 *
 * The generated tauri-specta bindings (`bindings/index.ts`) are post-processed
 * to import their `invoke` from THIS module instead of `@tauri-apps/api/core`
 * (see `apps/desktop/src-tauri/tests/bindings.rs`). That makes every generated
 * `commands.*` call inherit:
 *   - mock mode (`VITE_USE_MOCKS`) → `mocks.ts` `mockInvoke`, and
 *   - the spec-021 dev-tools recording proxy via `setInvokeOverride`.
 *
 * Keep this module dependency-light: it must not import `commands.ts` (which
 * imports from here), and it loads mocks / the real tauri core lazily.
 */

const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';

/**
 * Optional recording-proxy override installed by the dev-tools bootRecorder
 * (spec 021, T075 / SC-002). Null in release builds (zero overhead).
 */
let _invokeOverride: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null =
  null;

/** Install a recording proxy over the IPC dispatcher (dev-tools builds only). */
export function setInvokeOverride(
  fn: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null,
): void {
  _invokeOverride = fn;
}

/**
 * Dispatch an IPC command. Signature-compatible with `@tauri-apps/api/core`'s
 * `invoke` so the generated bindings can call it unchanged.
 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (_invokeOverride) {
    return _invokeOverride(cmd, args) as Promise<T>;
  }
  if (useMocks) {
    const { mockInvoke } = await import('./mocks');
    return mockInvoke<T>(cmd, args);
  }
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

/** A generated tauri-specta `Result` value. */
export type IpcResult<T, E = unknown> = { status: 'ok'; data: T } | { status: 'error'; error: E };

/**
 * Translate a generated `Result` into the throw-on-error contract the app's
 * call sites expect: returns `data` on success, throws `error` otherwise.
 */
export function unwrap<T, E = unknown>(result: IpcResult<T, E>): T {
  if (result.status === 'ok') {
    return result.data;
  }
  throw result.error;
}
