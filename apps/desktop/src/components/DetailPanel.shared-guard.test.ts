// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared-component guard — spec 054 T012a (owner mandate: "the panels should
 * be completely shared components that the individual pages can fill out
 * with data").
 *
 * A static source check (in the `scripts/css-dup-sniff.mjs` spirit — cheaper
 * and just as effective as mounting all five real detail components with
 * their full data/IPC mocking, which would duplicate each feature's own test
 * setup for no extra regression coverage): every ALREADY-MIGRATED list-page
 * detail component must render through the shared `DetailPanel` (source
 * contains a `<DetailPanel` JSX usage) and must NOT render `<DetailHeader`
 * directly (that's `DetailPanel`'s own internal implementation detail — a
 * consumer using it directly means it has bypassed `DetailPanel`).
 *
 * Runtime confirmation that `DetailPanel`'s root actually carries the
 * `data-shared-detail` marker lives in `DetailPanel.test.tsx` and
 * `ListPageLayout.containment.test.tsx` (which render real `DetailPanel`
 * instances and assert the attribute is present in the DOM).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATED_DETAIL_FILES = [
  'src/features/sessions/SessionDetail.tsx',
  'src/features/calibration/MasterDetail.tsx',
  'src/features/inbox/InboxDetail.tsx',
  'src/features/archive/ArchiveDetail.tsx',
  'src/features/targets/TargetDetailV2.tsx',
  'src/features/projects/ProjectDetail.tsx',
];

describe('shared DetailPanel guard (spec 054 T012a)', () => {
  it.each(
    MIGRATED_DETAIL_FILES,
  )('%s renders through DetailPanel, not a raw DetailHeader', (relPath) => {
    const source = readFileSync(resolve(process.cwd(), relPath), 'utf8');
    expect(source).toMatch(/<DetailPanel\b/);
    expect(source).not.toMatch(/<DetailHeader\b/);
  });
});
