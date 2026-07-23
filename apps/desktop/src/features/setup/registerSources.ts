// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Setup wizard source-registration IPC helper (spec 037 caller migration).
 *
 * Moves the `roots.register.batch` glue off the hand-written `@/api/commands`
 * wrapper onto the generated `commands.rootsRegisterBatch` binding (FR-004:
 * the behaviour is moved, not dropped). The real backend response carries
 * per-item results in `items`, correlated to the request by `index`; the
 * assigned source id is `sourceId`. This maps that response back to the
 * wizard's row shape (kind/path come from the request by index) so the scan
 * step receives the registered-source UUID — not the folder path — as
 * rootId. Passing the path made inbox items fail the `registered_sources`
 * JOIN and vanish.
 */

import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';

export interface BatchSourceEntry {
  kind: string;
  path: string;
  // Backend RegisterSourceRequest is camelCase — must be `scanDepth`.
  scanDepth: string;
  /** Required by the backend contract (spec 041 R-7). 'organized' | 'unorganized'. */
  organizationState: string;
}

export interface BatchRegisterResult {
  results: Array<{
    kind: string;
    path: string;
    success: boolean;
    /** Assigned registered-source id (UUID) on success — used as the scan rootId
     *  so inbox items JOIN back to `registered_sources`. */
    rootId?: string;
    error?: string;
  }>;
}

export async function registerRootBatch(args: {
  sources: BatchSourceEntry[];
}): Promise<BatchRegisterResult> {
  const resp = unwrap(
    await commands.rootsRegisterBatch({ sources: args.sources } as Parameters<
      typeof commands.rootsRegisterBatch
    >[0]),
  );

  const results = (resp.items ?? []).map((item) => {
    const src = args.sources[item.index];
    const success = item.status === 'success';
    return {
      kind: src?.kind ?? '',
      path: src?.path ?? '',
      success,
      rootId: success ? (item.sourceId ?? undefined) : undefined,
      error: item.error ?? undefined,
    };
  });
  return { results };
}
