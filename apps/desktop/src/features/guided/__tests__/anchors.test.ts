/**
 * T026 — Anchor CI gate (spec 010).
 *
 * Verifies that every `data-guide-anchor` value registered in `anchors.ts`
 * is present as a string literal in at least one anchor-host component source
 * file.  Uses Vite's `import.meta.glob` to read source files at test time.
 *
 * This test fails if an anchor id is registered in anchors.ts but not wired
 * into a real DOM element in any component.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_ANCHOR_IDS,
  ANCHOR_INBOX_CONFIRM_ROW,
  ANCHOR_PROJECTS_CREATE_CTA,
  ANCHOR_PROJECT_OPEN_IN_TOOL,
  GUIDE_ANCHOR_ATTR,
} from '../anchors';

// Read anchor-host component sources via Vite glob import (static analysis).
// The glob runs at compile time, so the paths must be relative to this file.
const ANCHOR_SOURCES = import.meta.glob(
  [
    '../../inbox/ActionSidebar.tsx',
    '../../projects/ProjectsPage.tsx',
    '../../projects/ProjectDetail.tsx',
  ],
  { as: 'raw', eager: true },
);

describe('T026 — anchor CI gate', () => {
  it('ALL_ANCHOR_IDS has exactly three entries (matching the three flow steps)', () => {
    expect(ALL_ANCHOR_IDS).toHaveLength(3);
  });

  it('exports the three expected anchor id constants', () => {
    expect(ANCHOR_INBOX_CONFIRM_ROW).toBe('inbox.confirm-row');
    expect(ANCHOR_PROJECTS_CREATE_CTA).toBe('projects.create-cta');
    expect(ANCHOR_PROJECT_OPEN_IN_TOOL).toBe('project.open-in-tool');
  });

  it('GUIDE_ANCHOR_ATTR is the correct attribute name', () => {
    expect(GUIDE_ANCHOR_ATTR).toBe('data-guide-anchor');
  });

  it('anchor-host source files were found by glob', () => {
    const keys = Object.keys(ANCHOR_SOURCES);
    expect(keys.length).toBeGreaterThanOrEqual(3);
  });

  it('every registered anchor id is present in at least one host component', () => {
    const combinedSource = Object.values(ANCHOR_SOURCES).join('\n');
    const missing: string[] = [];

    for (const anchorId of ALL_ANCHOR_IDS) {
      if (!combinedSource.includes(anchorId)) {
        missing.push(anchorId);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `The following anchor ids are registered in anchors.ts but not found ` +
          `in any anchor-host component:\n  ${missing.join('\n  ')}\n\n` +
          `Add \`${GUIDE_ANCHOR_ATTR}="${missing[0]}"\` to the relevant component.`,
      );
    }

    expect(missing).toHaveLength(0);
  });

  it('inbox.confirm-row anchor is present in ActionSidebar.tsx', () => {
    const source = Object.entries(ANCHOR_SOURCES).find(([k]) =>
      k.includes('ActionSidebar'),
    )?.[1] ?? '';
    expect(source).toContain(ANCHOR_INBOX_CONFIRM_ROW);
  });

  it('projects.create-cta anchor is present in ProjectsPage.tsx', () => {
    const source = Object.entries(ANCHOR_SOURCES).find(([k]) =>
      k.includes('ProjectsPage'),
    )?.[1] ?? '';
    expect(source).toContain(ANCHOR_PROJECTS_CREATE_CTA);
  });

  it('project.open-in-tool anchor is present in ProjectDetail.tsx', () => {
    const source = Object.entries(ANCHOR_SOURCES).find(([k]) =>
      k.includes('ProjectDetail'),
    )?.[1] ?? '';
    expect(source).toContain(ANCHOR_PROJECT_OPEN_IN_TOOL);
  });
});
