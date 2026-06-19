/**
 * Spec 037 Phase 1 — proves the generated tauri-specta bindings dispatch through
 * our IPC switcher (api/ipc.ts), not directly through @tauri-apps/api/core, so
 * mock mode and the dev-tools recording proxy keep working (FR-002 / US2).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { commands } from '@/bindings';
import { setInvokeOverride, unwrap } from './ipc';

afterEach(() => setInvokeOverride(null));

describe('generated bindings route through the IPC switcher (FR-002)', () => {
  it('a generated command call is observed by the recording override', async () => {
    const calls: string[] = [];
    setInvokeOverride((cmd) => {
      calls.push(cmd);
      return Promise.resolve([]);
    });
    const res = await commands.sessionsList();
    expect(calls).toContain('sessions_list');
    expect(res.status).toBe('ok');
  });
});

describe('unwrap (FR-003)', () => {
  it('returns data on ok', () => {
    expect(unwrap({ status: 'ok', data: 42 })).toBe(42);
  });
  it('throws the error on error', () => {
    expect(() => unwrap({ status: 'error', error: new Error('boom') })).toThrow('boom');
  });
});
