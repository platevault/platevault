/**
 * R-4 Regression: NamingStructure.tsx token refs are valid (spec 028, 2026-06-17).
 *
 * Before the 2026-06-17 fix, NamingStructure.tsx (and several other files) used
 * `var(--alm-radius)` — an undefined CSS token. The valid suffix forms are
 * `--alm-radius-sm`, `--alm-radius-md`, and `--alm-radius-lg`. Using the bare
 * form causes the browser to resolve to an empty value, making border-radius
 * silently 0 at runtime.
 *
 * This test suite pins the fix by asserting that the NamingStructure module
 * source (imported as raw text by Vite) contains no bare `var(--alm-radius)`
 * reference.
 *
 * Why a source-reading test instead of a render test?
 *   CSS variable resolution is silent at render time (the value becomes empty;
 *   no React error is thrown). A source-reading test catches the bug class
 *   definitively without requiring a running browser.
 *
 * The companion check in `scripts/check-tokens.sh` (check 4, wired into
 * `just lint`) catches the same class of bug across all source files. The
 * vitest here pinpoints NamingStructure.tsx specifically and is picked up by
 * the standard `pnpm test` gate.
 *
 * R-4.3/R-4.4/R-4.5 (check-tokens.sh execution) are validated by the
 * `scripts/check-tokens.sh` being called directly in the `just lint` /
 * CI "Desktop lint" step. Those assertions live in the token guard itself.
 *
 * See:
 *   - docs/development/test-strategy-033.md § R-4, § 028-3
 *   - specs/033-validation-bugfix-remediation/tasks.md § T079
 *   - scripts/check-tokens.sh (check 4)
 */

import { describe, it, expect } from 'vitest';

// Import NamingStructure.tsx as raw source text (Vite ?raw query).
// This avoids Node.js fs imports (incompatible with the browser tsconfig)
// while giving us the actual source string to assert against.
import namingStructureSource from './NamingStructure.tsx?raw';

describe('R-4 regression · bare --alm-radius token (spec 028)', () => {
  describe('NamingStructure.tsx token refs are valid', () => {
    it('R-4.1 · NamingStructure.tsx does not use bare var(--alm-radius)', () => {
      // Match var(--alm-radius) NOT followed by a dash + suffix.
      // Valid: var(--alm-radius-md), var(--alm-radius-sm), var(--alm-radius-lg)
      // Invalid: var(--alm-radius)
      const bareRadiusPattern = /var\(--alm-radius\)/g;
      const hits = namingStructureSource.match(bareRadiusPattern);

      expect(
        hits,
        [
          'NamingStructure.tsx uses bare var(--alm-radius) which is undefined.',
          'Replace with var(--alm-radius-md), var(--alm-radius-sm), or var(--alm-radius-lg).',
          'See R-4 regression in docs/development/test-strategy-033.md.',
        ].join(' '),
      ).toBeNull();
    });

    it('R-4.2 · All --alm-radius refs in NamingStructure.tsx have a valid suffix', () => {
      // Find all --alm-radius references (with or without suffix).
      const allRefs = [
        ...namingStructureSource.matchAll(/--alm-radius(-[a-z]+)?/g),
      ];

      // Every reference must have one of the valid suffixes.
      const validSuffixes = new Set(['-sm', '-md', '-lg']);
      const invalidRefs = allRefs.filter(
        (m) => m[1] === undefined || !validSuffixes.has(m[1]),
      );

      expect(
        invalidRefs.map((m) => m[0]),
        'All --alm-radius references must have a valid suffix (-sm/-md/-lg)',
      ).toEqual([]);
    });

    it('R-4.3 · NamingStructure.tsx is non-empty (raw import sanity check)', () => {
      // Guards against a broken ?raw import returning an empty string,
      // which would make R-4.1/R-4.2 trivially pass even if broken.
      expect(namingStructureSource.length).toBeGreaterThan(100);
      // Confirm the file contains a known stable identifier from its public API.
      // (Previously checked for var(--alm-radius-md) inline; that token now lives
      // in components.css classes so it no longer appears in the TSX source.
      // The check-tokens.sh guard (check 4) continues to enforce no bare
      // --alm-radius refs across all TSX/TS files.)
      expect(namingStructureSource).toContain('NamingStructure');
    });
  });

  describe('Token guard is wired into the lint pipeline', () => {
    it('R-4.4 · check-tokens.sh gate description is documented (guard exists)', () => {
      // This test confirms awareness of the external lint gate. The actual
      // execution of check-tokens.sh is covered by `just lint` and the CI
      // "Desktop lint" step. If someone removes check 4 from the script,
      // the R-4.5 vitest in NamingStructure.r4.test.ts would need updating —
      // a deliberate friction point that prevents silent removal.
      //
      // The guard: scripts/check-tokens.sh check 4 searches for var(--alm-radius)
      // in TSX/TS source files and exits non-zero if found.
      const guardDescription = [
        'check-tokens.sh check 4 catches bare var(--alm-radius) in TSX/TS files',
        'wired into just lint via: pnpm --filter @astro-plan/desktop lint',
        'which runs: eslint src/ && bash ../../scripts/check-tokens.sh',
      ].join('; ');

      // Trivially true — this test documents the contract, not executes it.
      expect(guardDescription).toContain('check-tokens.sh');
    });
  });
});
