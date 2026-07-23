// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Regression: the checklist's blocked-item prerequisite reason resolves the
 * backend's DOTTED registry reason key (spec 056, FR-010).
 *
 * The backend emits `reason_key: "onboarding.prerequisite.<upstream_item_id>"`
 * (`crates/app/core/src/onboarding.rs:438`), but Paraglide message functions
 * are underscore-keyed. Rendering a blocked item looked the raw dotted key up
 * in the message catalog — `catalog["onboarding.prerequisite.inbox.confirm_first"]`
 * is `undefined`, so `undefined()` threw and crashed the ENTIRE shell into the
 * error boundary on first run (the only place a blocked prerequisite renders).
 * Mocks return `prerequisite: null` (mocks.ts), so no mock/L1 path ever hit it;
 * only the real backend populates prerequisites (caught by the Layer-2
 * `onboarding_journey` real-UI test, which now renders the checklist).
 *
 * `prerequisiteReason` must convert dots→underscores exactly as `itemLabel`/
 * `itemTooltip` do, and resolve to the real English strings for every reason
 * key the backend can send.
 */

import { describe, it, expect } from 'vitest';
import { prerequisiteReason } from './ChecklistSection';

// The full set of `upstream_item_id`s the backend can name as a prerequisite
// (`crates/app/core/src/onboarding.rs` registry) → dotted reason key + its
// en.json string. A dotted key that fails to resolve throws (the shipped bug);
// a renamed/removed en.json key mismatches the expected text.
const REASON_KEYS: ReadonlyArray<readonly [string, string]> = [
  [
    'onboarding.prerequisite.inbox.confirm_first',
    'Unlocks once you confirm an inventory item.',
  ],
  [
    'onboarding.prerequisite.targets.resolve_first',
    'Unlocks once you resolve a target.',
  ],
  [
    'onboarding.prerequisite.projects.create_first',
    'Unlocks once you create a project.',
  ],
  [
    'onboarding.prerequisite.projects.launch_tool',
    'Unlocks once you open your project in a tool.',
  ],
];

describe('prerequisiteReason (FR-010 dotted reason-key resolution)', () => {
  it.each(REASON_KEYS)(
    'resolves dotted backend reason key %s without throwing',
    (reasonKey, expected) => {
      expect(() => prerequisiteReason(reasonKey)).not.toThrow();
      expect(prerequisiteReason(reasonKey)).toBe(expected);
    },
  );
});
