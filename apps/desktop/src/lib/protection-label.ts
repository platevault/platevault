// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Localized labels for spec-016 source protection levels (issue #801).
 *
 * Cleanup-candidate tables used to render the `protected` case through the
 * catalog and print every other case as the raw backend string. This is the
 * one place a protection value becomes user-facing prose.
 *
 * Callers own the `Pill` variant: the same level reads differently per
 * surface (in Settings `protected` is reassuring — `ok`; in a cleanup
 * candidate table it is a blocker — `warn`), so only the label is shared.
 */

import type { ProtectionLevel } from '@/bindings/index';
import { m } from '@/lib/i18n';

const LEVEL_LABEL: Record<ProtectionLevel, () => string> = {
  protected: m.settings_cleanup_protection_protected,
  unprotected: m.settings_cleanup_protection_unprotected,
};

/**
 * Label an effective protection level.
 *
 * `protection` is typed `string` on the cleanup-candidate DTOs rather than as
 * the closed `ProtectionLevel` union, so unknown values are possible on the
 * wire. Anything that is not `protected` collapses to `unprotected`, mirroring
 * `ProtectionLevel::parse_level` in crates/contracts/core/src/protection.rs —
 * the UI must not report a frame as unprotected-looking when the backend would
 * treat it as protected, and vice versa.
 */
export function protectionLabel(protection: string): string {
  return protection === 'protected'
    ? LEVEL_LABEL.protected()
    : LEVEL_LABEL.unprotected();
}

/** True when `protection` resolves to the protected level. */
export function isProtectedLevel(
  protection: string | null | undefined,
): boolean {
  return protection === 'protected';
}
