/**
 * Regression test for registerRootBatch's response mapping.
 *
 * The generated `roots_register_batch` response is `{ status, items: [{ index,
 * status, sourceId, error }] }` — the assigned source id lives on `sourceId`.
 * An earlier version cast the response to an invented `{ results: [{ root }] }`
 * shape and read `item.root?.id`, which was always undefined on the real
 * backend.  flushToDB then fell back to the folder path as the scan rootId, so
 * inbox items were written with `root_id = <path>` and never matched the
 * `registered_sources` JOIN — the Inbox showed nothing.  Mock mode hid it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { registerRootBatch } from './commands';
import { setInvokeOverride } from './ipc';

afterEach(() => setInvokeOverride(null));

describe('registerRootBatch maps the generated response shape', () => {
  it('carries sourceId through as rootId and correlates rows by index', async () => {
    setInvokeOverride((cmd) => {
      if (cmd !== 'roots_register_batch') return Promise.resolve(null);
      return Promise.resolve({
        status: 'partial',
        items: [
          { index: 0, status: 'success', sourceId: 'uuid-capture', error: null },
          { index: 1, status: 'failure', sourceId: null, error: 'permission_denied' },
        ],
      });
    });

    const out = await registerRootBatch({
      sources: [
        { kind: 'capture', path: 'D:/Astro/Captures', scanDepth: 'recursive' },
        { kind: 'inbox', path: 'D:/Astro/Inbox', scanDepth: 'single' },
      ],
    });

    expect(out.results).toHaveLength(2);
    // Successful row carries the registered-source UUID as rootId (NOT the path).
    expect(out.results[0]).toEqual({
      kind: 'capture',
      path: 'D:/Astro/Captures',
      success: true,
      rootId: 'uuid-capture',
      error: undefined,
    });
    // Failed row has no rootId and surfaces the error.
    expect(out.results[1].success).toBe(false);
    expect(out.results[1].rootId).toBeUndefined();
    expect(out.results[1].path).toBe('D:/Astro/Inbox');
    expect(out.results[1].error).toBe('permission_denied');
  });
});
