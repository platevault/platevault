/**
 * Spec 037 IPC-boundary teardown guards (SC-001 + SC-005).
 *
 * These scan the whole `src` tree so the drift-bug class the migration removed
 * cannot silently return:
 *
 * - SC-005: no module may import the retired hand-written `@/api/commands`
 *   wrapper (static import, dynamic `import()`, or `vi.mock`). Every caller goes
 *   through the generated `commands.*` bindings instead.
 * - SC-001: no hand-written `invoke('...')` string-literal call may exist
 *   outside the single dispatch switcher (`src/api/ipc.ts`). The generated
 *   bindings dispatch via the distinct `__TAURI_INVOKE` identifier (routed
 *   through the switcher), and `@tauri-apps/api/core`'s raw `invoke` is only
 *   reached inside the switcher.
 */

import { describe, it, expect } from 'vitest';

// Vite reads every source file at build time (`?raw`, eager) so the scan needs
// no Node fs/path APIs and works under the desktop tsconfig.
const raw = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Strip block + line comments so prose mentioning `invoke('…')` doesn't trip
 *  the scanners. (`[^:]` guards the `://` in URLs from the line-comment rule.) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = Object.entries(raw)
  .filter(([path]) => !path.includes('/paraglide/') && !path.endsWith('/api/ipc-boundary.guard.test.ts'))
  .map(([path, src]) => ({ path, src: stripComments(src) }));

describe('spec 037 — IPC boundary guards', () => {
  it('has files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('SC-005: nothing imports the retired @/api/commands wrapper', () => {
    const re = /(from\s*['"]@\/api\/commands['"])|(import\(\s*['"]@\/api\/commands['"])|(vi\.mock\(\s*['"]@\/api\/commands['"])/;
    const offenders = files.filter((f) => re.test(f.src)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('SC-001: no hand-written invoke() string literal outside the dispatch switcher', () => {
    // A hand-written call: `invoke('cmd'` / `invoke<T>("cmd"`. The generated
    // bindings use the distinct `__TAURI_INVOKE` identifier, which this misses.
    const re = /\binvoke\s*(<[^>]*>)?\(\s*['"`]/;
    const offenders = files
      .filter((f) => !f.path.endsWith('/api/ipc.ts') && !f.path.endsWith('/bindings/index.ts'))
      .filter((f) => re.test(f.src))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
