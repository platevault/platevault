// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Narrows `value` to `T`, throwing loudly if it is `null`/`undefined`.
 *
 * Tests frequently pull a single item out of a DOM query or an array `.find`,
 * both typed as possibly-absent. `expect(value).toBeDefined()` documents the
 * intent but does not narrow the type for TypeScript, and `value!` narrows
 * the type without checking anything at runtime — if the value is actually
 * absent, every assertion after it that only reads optional-chained
 * properties (`value?.foo`) can pass vacuously instead of failing. This
 * throws immediately with a message identifying what was missing, so a
 * regression that makes the value absent fails the test instead of hiding
 * behind an `undefined` that compares equal to nothing.
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message: string,
): T {
  if (value === null || value === undefined) {
    throw new Error(`assertDefined: ${message}`);
  }
  return value;
}
